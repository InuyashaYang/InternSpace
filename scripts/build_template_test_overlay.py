#!/usr/bin/env python3
"""Build a sanitized template-test view overlay from public GitHub Issue/PR data."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "ingest" / "template-test-overlay.config.json"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "template-test-overlay.json"
GITHUB_API = "https://api.github.com"
WANDB_HOST = "wandb.ai"
TOKEN_TEXT = re.compile(r"(?i)(?:access[_-]?token|api[_-]?key|client[_-]?secret|private[_-]?token)")
MARKDOWN_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
URL_PATTERN = re.compile(r"https://[^\s)\]>]+")
PLACEHOLDER = re.compile(r"^<?(?:value|path|step|token count|exact checkpoint or revision|commit or package version)>?$", re.I)


class OverlayBuildError(ValueError):
    """The external template cannot be converted into a safe overlay."""


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def fetch_json(url: str, token: str | None = None) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "InternSpace-template-overlay/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise OverlayBuildError(f"cannot fetch external template metadata from {url}: {error}") from error


def fetch_text(url: str, limit: int = 250_000) -> str:
    request = Request(url, headers={"User-Agent": "InternSpace-template-overlay/1.0"})
    try:
        with urlopen(request, timeout=30) as response:
            payload = response.read(limit + 1)
    except (HTTPError, URLError, TimeoutError) as error:
        raise OverlayBuildError(f"cannot fetch external code snapshot from {url}: {error}") from error
    if len(payload) > limit:
        raise OverlayBuildError(f"external code snapshot exceeds {limit} bytes: {url}")
    return payload.decode("utf-8")


def github_payloads(
    repository: str, issue_number: int, pr_number: int, token: str | None
) -> tuple[dict, dict, list, list]:
    base = f"{GITHUB_API}/repos/{repository}"
    issue = fetch_json(f"{base}/issues/{issue_number}", token)
    pull_request = fetch_json(f"{base}/pulls/{pr_number}", token)
    files = fetch_json(f"{base}/pulls/{pr_number}/files?per_page=100", token)
    commits = fetch_json(f"{base}/pulls/{pr_number}/commits?per_page=100", token)
    if not isinstance(issue, dict) or not isinstance(pull_request, dict) or not isinstance(files, list) or not isinstance(commits, list):
        raise OverlayBuildError("GitHub returned an unexpected Issue/PR payload shape")
    head = pull_request.get("head") if isinstance(pull_request.get("head"), Mapping) else {}
    head_repo = head.get("repo") if isinstance(head.get("repo"), Mapping) else {}
    head_name = head_repo.get("full_name")
    head_revision = head.get("sha")
    enriched_files = []
    for record in files:
        enriched = dict(record)
        path = record.get("filename")
        if isinstance(head_name, str) and isinstance(head_revision, str) and isinstance(path, str):
            raw_url = f"https://raw.githubusercontent.com/{head_name}/{head_revision}/{quote(path, safe='/')}"
            enriched["_content"] = fetch_text(raw_url)
        enriched_files.append(enriched)
    return issue, pull_request, enriched_files, commits


def clean_markdown(value: str) -> str:
    value = MARKDOWN_COMMENT.sub("", value or "")
    value = value.replace("\r", "")
    return value.strip()


def markdown_section(body: str, heading: str) -> str:
    source = clean_markdown(body)
    pattern = re.compile(rf"^(?P<level>#{{2,4}})\s+{re.escape(heading)}\s*$", re.I | re.M)
    match = pattern.search(source)
    if not match:
        return ""
    level = len(match.group("level"))
    following = source[match.end():]
    end = re.search(rf"^#{{2,{level}}}\s+", following, re.M)
    return following[: end.start() if end else None].strip()


def bold_field(body: str, label: str) -> str:
    source = clean_markdown(body)
    pattern = re.compile(
        rf"^\*\*{re.escape(label)}\*\*\s*$\n(?P<value>.*?)(?=^\*\*[^\n]+\*\*\s*$|^#{{2,4}}\s+|\Z)",
        re.I | re.M | re.S,
    )
    match = pattern.search(source)
    return match.group("value").strip() if match else ""


def first_content_line(value: str) -> str:
    for line in clean_markdown(value).splitlines():
        text = line.strip().strip("`")
        if text and text != "_No response_":
            return text
    return ""


def slug(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return text or "submission"


def metric_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def coerce_scalar(value: str) -> Any:
    text = value.strip().strip("`").strip()
    if not text or PLACEHOLDER.match(text):
        return None
    lowered = text.lower()
    if lowered in {"enabled", "true", "yes"}:
        return True
    if lowered in {"disabled", "false", "no"}:
        return False
    if lowered == "none":
        return None
    numeric = text.replace(",", "")
    if re.fullmatch(r"[-+]?\d+", numeric):
        return int(numeric)
    if re.fullmatch(r"[-+]?(?:\d+(?:\.\d*)?|\d*\.\d+)(?:e[-+]?\d+)?", numeric, re.I):
        number = float(numeric)
        return number if math.isfinite(number) else text
    throughput = re.fullmatch(r"(\d+(?:\.\d+)?)k\s+tokens/s", lowered)
    if throughput:
        return int(float(throughput.group(1)) * 1000)
    seconds = re.fullmatch(r"(\d+(?:\.\d+)?)\s*s", lowered)
    if seconds:
        return float(seconds.group(1))
    return text


def markdown_table(section: str) -> dict[str, Any]:
    rows: dict[str, Any] = {}
    for line in section.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2 or cells[0].lower() in {"field", "metric", "check"}:
            continue
        if all(re.fullmatch(r":?-+:?", cell.replace(" ", "")) for cell in cells[:2]):
            continue
        value = coerce_scalar(cells[1])
        if value is not None:
            rows[metric_key(cells[0])] = value
    return rows


def sanitized_wandb_urls(body: str) -> tuple[list[str], bool]:
    results: list[str] = []
    stripped_credentials = False
    for candidate in URL_PATTERN.findall(body or ""):
        candidate = candidate.rstrip(".,;`")
        parsed = urlsplit(candidate)
        if parsed.hostname != WANDB_HOST or parsed.scheme != "https":
            continue
        if parsed.query or parsed.fragment or parsed.username or parsed.password:
            stripped_credentials = True
        sanitized = urlunsplit(("https", WANDB_HOST, parsed.path, "", ""))
        if sanitized not in results:
            results.append(sanitized)
    return results, stripped_credentials


def safe_links(body: str) -> list[str]:
    links: list[str] = []
    for candidate in URL_PATTERN.findall(body or ""):
        candidate = candidate.rstrip(".,;`")
        parsed = urlsplit(candidate)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            continue
        sanitized = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        if sanitized not in links and parsed.hostname != WANDB_HOST:
            links.append(sanitized)
    return links


def compact_text(value: str, limit: int = 1200) -> str:
    text = re.sub(r"\s+", " ", clean_markdown(value)).strip()
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def code_snapshot(content: str | None) -> dict[str, Any]:
    if not content:
        return {"content_sha256": None, "line_count": None, "symbols": [], "excerpt": ""}
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    lines = content.splitlines()
    symbols = []
    symbol_pattern = re.compile(r"^\s*(?:async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)")
    for line in lines:
        match = symbol_pattern.match(line)
        if match and match.group(1) not in symbols:
            symbols.append(match.group(1))
    start = next((index for index, line in enumerate(lines) if symbol_pattern.match(line)), 0)
    excerpt = "\n".join(lines[start : start + 48]).strip()
    if len(excerpt) > 6000:
        excerpt = f"{excerpt[:5999]}…"
    if TOKEN_TEXT.search(excerpt):
        excerpt = ""
    return {
        "content_sha256": digest,
        "line_count": len(lines),
        "symbols": symbols[:80],
        "excerpt": excerpt,
    }


def relation_records(issue: Mapping[str, Any], pr: Mapping[str, Any], body_links: list[str]) -> list[dict]:
    relations = [
        {"type": "proposal_issue", "label": f"Issue #{issue.get('number')}", "url": issue.get("html_url")},
        {"type": "implementation_pr", "label": f"PR #{pr.get('number')}", "url": pr.get("html_url")},
    ]
    for index, url in enumerate(body_links, start=1):
        relations.append({"type": "external_reference", "label": f"Reference {index}", "url": url})
    return [relation for relation in relations if isinstance(relation.get("url"), str)]


def build_submission(
    config: Mapping[str, Any],
    issue: Mapping[str, Any],
    pr: Mapping[str, Any],
    files: list[Mapping[str, Any]],
    commits: list[Mapping[str, Any]],
) -> tuple[dict, dict]:
    issue_body = str(issue.get("body") or "")
    pr_body = str(pr.get("body") or "")
    architecture_id = first_content_line(markdown_section(issue_body, "Architecture ID"))
    if not architecture_id:
        match = re.search(r"\*\*Architecture ID:\*\*\s*`?([^`\s]+)", pr_body, re.I)
        architecture_id = match.group(1) if match else "unknown-architecture"
    external_id = slug(architecture_id)
    wandb_urls, stripped_credentials = sanitized_wandb_urls(pr_body)
    model_configuration = markdown_table(markdown_section(pr_body, "Model Configuration"))
    final_metrics = markdown_table(markdown_section(pr_body, "Training Summary"))
    summary_section = markdown_section(pr_body, "Implementation Summary") or markdown_section(pr_body, "Architecture Summary")
    summary_section = re.split(r"^#{3,4}\s+", summary_section, maxsplit=1, flags=re.M)[0]
    summary = compact_text(summary_section)
    hypothesis = compact_text(bold_field(issue_body, "Research hypothesis"))
    proposal_type = first_content_line(markdown_section(issue_body, "Proposal type")) or "architecture proposal"
    head = pr.get("head") if isinstance(pr.get("head"), Mapping) else {}
    head_repo = head.get("repo") if isinstance(head.get("repo"), Mapping) else {}
    head_revision = str(head.get("sha") or "")
    repository_url = str(head_repo.get("html_url") or "")
    implementation_files = []
    for record in files:
        path = record.get("filename")
        if not isinstance(path, str) or not path:
            continue
        url = None
        if repository_url and len(head_revision) == 40:
            url = f"{repository_url}/blob/{head_revision}/{path}"
        elif isinstance(record.get("blob_url"), str):
            url = record.get("blob_url")
        snapshot = code_snapshot(record.get("_content") if isinstance(record.get("_content"), str) else None)
        implementation_files.append({
            "path": path,
            "url": url,
            "status": record.get("status"),
            "additions": record.get("additions"),
            "deletions": record.get("deletions"),
            "blob_sha": record.get("sha"),
            **snapshot,
        })
    commit_records = []
    for record in commits:
        sha = str(record.get("sha") or "")
        commit = record.get("commit") if isinstance(record.get("commit"), Mapping) else {}
        author = commit.get("author") if isinstance(commit.get("author"), Mapping) else {}
        message = str(commit.get("message") or "").splitlines()[0]
        url = None
        if repository_url and len(sha) == 40:
            url = f"{repository_url}/commit/{sha}"
        elif isinstance(record.get("html_url"), str):
            url = record.get("html_url")
        if len(sha) == 40:
            commit_records.append({
                "sha": sha,
                "message": message,
                "author": author.get("name"),
                "authored_at": author.get("date"),
                "url": url,
            })
    warnings = [
        "Temporary display alias: OLMo2 and OLMo3 are treated as one point for this overlay prototype.",
        "External display fields replace local display fields; canonical identity and structural relations remain local.",
    ]
    if stripped_credentials:
        warnings.append("Credential-bearing W&B query parameters were removed; the exposed token must be rotated at its source.")
    if "olmo2" in external_id and "olmo3" in str(head_repo.get("full_name") or "").lower():
        warnings.append("Submission metadata still names OLMo2 while the current PR head repository and synchronized code are OLMo3; both are retained under the temporary equivalence rule.")
    if "<value>" in pr_body or "<exact checkpoint or revision>" in pr_body:
        warnings.append("Unfilled benchmark placeholders were ignored and are not rendered as completed results.")
    issue_url = str(issue.get("html_url") or "")
    pr_url = str(pr.get("html_url") or "")
    body_links = safe_links(issue_body) + [url for url in safe_links(pr_body) if url not in safe_links(issue_body)]
    node = {
        "id": f"template-test-{external_id}",
        "external_architecture_id": external_id,
        "maps_to_feature_id": config["maps_to_feature_id"],
        "merge_strategy": config.get("merge_strategy", "external-display-local-structure"),
        "title": str(pr.get("title") or issue.get("title") or architecture_id),
        "title_zh": config.get("title_zh", ""),
        "summary": summary,
        "summary_zh": config.get("summary_zh", ""),
        "status": str(pr.get("state") or issue.get("state") or "open").lower(),
        "proposal_type": proposal_type,
        "hypothesis": hypothesis,
        "temporary_equivalence": config.get("temporary_equivalence", {}),
        "issue": {
            "number": issue.get("number"),
            "title": issue.get("title"),
            "url": issue_url,
            "state": str(issue.get("state") or "").lower(),
            "author": (issue.get("user") or {}).get("login") if isinstance(issue.get("user"), Mapping) else None,
            "updated_at": issue.get("updated_at"),
        },
        "pull_request": {
            "number": pr.get("number"),
            "title": pr.get("title"),
            "url": pr_url,
            "state": str(pr.get("state") or "").lower(),
            "author": (pr.get("user") or {}).get("login") if isinstance(pr.get("user"), Mapping) else None,
            "head_repository": head_repo.get("full_name"),
            "head_revision": head_revision,
            "updated_at": pr.get("updated_at"),
        },
        "model_configuration": model_configuration,
        "commits": commit_records,
        "implementation_files": implementation_files,
        "relations": relation_records(issue, pr, body_links),
        "warnings": warnings,
    }
    evidence = [
        {"label": "template-test proposal", "locator": issue_url, "summary": "Architecture proposal imported from template-test."},
        {"label": "template-test implementation PR", "locator": pr_url, "revision": head_revision or None, "summary": "Implementation and result claims imported from template-test."},
    ]
    experiment = {
        "id": f"exp-template-test-{external_id}",
        "title": f"{node['title']} training record",
        "title_zh": f"{node['title_zh']}训练记录" if node["title_zh"] else "外部模板训练记录",
        "type": "training_reference",
        "status": "completed" if final_metrics else "planned",
        "cursor_type": "wandb-final" if wandb_urls and final_metrics else "none",
        "covered_feature_ids": [config["maps_to_feature_id"]],
        "primary_feature_ids": [config["maps_to_feature_id"]],
        "summary": "Training summary adapted from the linked template-test PR; external claims remain attributed to that PR.",
        "summary_zh": "由 template-test PR 的训练摘要适配而来；结果仍归因于外部提交，未自动升级为 InternSpace 的验证结论。",
        "wandb_url": wandb_urls[0] if wandb_urls else None,
        "final_metrics": final_metrics,
        "replay": {"enabled": False, "source": None, "loss_trace": []},
        "evidence": evidence,
        "replaces_experiment_id": config.get("replaces_experiment_id"),
        "overlay_source_node_id": node["id"],
    }
    return node, experiment


def build_overlay(
    config: Mapping[str, Any], payloads: Mapping[tuple[int, int], tuple[dict, dict, list, list]], fetched_at: str
) -> dict:
    nodes = []
    experiments = []
    for submission in config.get("submissions", []):
        key = (int(submission["issue_number"]), int(submission["pull_request_number"]))
        if key not in payloads:
            raise OverlayBuildError(f"missing payloads for Issue #{key[0]} / PR #{key[1]}")
        node, experiment = build_submission(submission, *payloads[key])
        nodes.append(node)
        experiments.append(experiment)
    document = {
        "schema_version": "1.0.0",
        "overlay_id": config.get("overlay_id", "template-test-overlay"),
        "source_repository": config["source_repository"],
        "fetched_at": fetched_at,
        "merge_policy": {
            "external_display_precedence": True,
            "preserve_local_identity": True,
            "preserve_local_structure": True,
            "preserve_relation_union": True,
        },
        "nodes": nodes,
        "experiments": experiments,
    }
    serialized = json.dumps(document, ensure_ascii=False)
    if TOKEN_TEXT.search(serialized) or "?" in "".join(
        experiment.get("wandb_url") or "" for experiment in experiments
    ):
        raise OverlayBuildError("sanitized overlay still contains credential-like material")
    return document


def write_json_atomic(path: Path, document: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--issue-json", type=Path)
    parser.add_argument("--pr-json", type=Path)
    parser.add_argument("--pr-files-json", type=Path)
    parser.add_argument("--pr-commits-json", type=Path)
    parser.add_argument("--fetched-at")
    parser.add_argument("--fallback-existing", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        config = load_json(args.config)
        submissions = config.get("submissions", [])
        if len(submissions) != 1 and any((args.issue_json, args.pr_json, args.pr_files_json, args.pr_commits_json)):
            raise OverlayBuildError("fixture file arguments currently require exactly one configured submission")
        payloads: dict[tuple[int, int], tuple[dict, dict, list, list]] = {}
        if args.issue_json or args.pr_json or args.pr_files_json or args.pr_commits_json:
            if not all((args.issue_json, args.pr_json, args.pr_files_json, args.pr_commits_json)):
                raise OverlayBuildError("fixture JSON arguments for Issue, PR, files and commits must be provided together")
            submission = submissions[0]
            key = (int(submission["issue_number"]), int(submission["pull_request_number"]))
            payloads[key] = (
                load_json(args.issue_json),
                load_json(args.pr_json),
                load_json(args.pr_files_json),
                load_json(args.pr_commits_json),
            )
        else:
            token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
            for submission in submissions:
                key = (int(submission["issue_number"]), int(submission["pull_request_number"]))
                payloads[key] = github_payloads(config["source_repository"], *key, token)
        fetched_at = args.fetched_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        document = build_overlay(config, payloads, fetched_at)
        write_json_atomic(args.output, document)
        print(f"OVERLAY_OK {args.output} ({len(document['nodes'])} mapped nodes, {len(document['experiments'])} experiments)")
        return 0
    except (OSError, KeyError, TypeError, ValueError, OverlayBuildError) as error:
        if args.fallback_existing and args.output.is_file():
            print(f"WARNING: keeping existing template overlay after refresh failure: {error}", file=sys.stderr)
            return 0
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
