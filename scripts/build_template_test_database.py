#!/usr/bin/env python3
"""Build the public template-test model database used by the primary web graph."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

try:
    from scripts.build_template_test_overlay import (
        GITHUB_API,
        OverlayBuildError,
        code_snapshot,
        fetch_json,
        markdown_section,
        write_json_atomic,
    )
except ModuleNotFoundError:  # pragma: no cover - direct execution fallback
    from build_template_test_overlay import (
        GITHUB_API,
        OverlayBuildError,
        code_snapshot,
        fetch_json,
        markdown_section,
        write_json_atomic,
    )


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "ingest" / "template-test-database.config.json"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "template-test-data.json"
CREDENTIAL_KEY = re.compile(r"(?i)(?:access.?token|auth|credential|api.?key|secret|signature)")
CREDENTIAL_VALUE = re.compile(
    r"github_pat_[A-Za-z0-9_]{10,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bBearer\s+[A-Za-z0-9._-]{12,}",
    re.I,
)
INTERNAL_PATH = re.compile(r"(?<![A-Za-z0-9])/(?:home|root|mnt|private|Users)/[^\s'\"<>]+")
WEB_URL = re.compile(r"https://[^\s<>'\")\]]+")
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)


class DatabaseBuildError(ValueError):
    """The external database cannot be fetched or sanitized safely."""


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def api_url(repository: str, path: str) -> str:
    base = f"{GITHUB_API}/repos/{repository}"
    suffix = path.lstrip("/")
    return f"{base}/{suffix}" if suffix else base


def with_query(url: str, **params: str) -> str:
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update(params)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def fetch_all_pages(url: str, token: str | None) -> list[Any]:
    rows: list[Any] = []
    for page in range(1, 101):
        payload = fetch_json(with_query(url, per_page="100", page=str(page)), token)
        if not isinstance(payload, list):
            raise DatabaseBuildError(f"expected array response from {url}")
        rows.extend(payload)
        if len(payload) < 100:
            return rows
    raise DatabaseBuildError(f"pagination exceeded 100 pages for {url}")


def clean_markdown(value: Any) -> str:
    text = re.sub(r"<!--[\s\S]*?-->", "", str(value or ""))
    text = text.replace("\r\n", "\n").strip()
    if re.fullmatch(r"_?No response_?", text, re.I):
        return ""
    return sanitize_text(text)


def sanitize_url(value: str) -> str:
    try:
        parsed = urlsplit(value.rstrip(".,;`"))
    except ValueError:
        return ""
    if parsed.scheme != "https" or not parsed.hostname:
        return ""
    safe_query = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not CREDENTIAL_KEY.search(key)
    ]
    if parsed.hostname == "wandb.ai":
        safe_query = []
    return urlunsplit(("https", parsed.hostname, parsed.path, urlencode(safe_query), ""))


def sanitize_text(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        return sanitize_url(match.group(0)) or ""

    text = WEB_URL.sub(replace, value)
    text = CREDENTIAL_VALUE.sub("[redacted credential]", text)
    return INTERNAL_PATH.sub("[redacted local path]", text)


def fetch_repository_text(
    repository: str,
    path: str,
    revision: str,
    token: str | None,
    limit: int = 250_000,
) -> str:
    quoted_path = quote(path, safe="/")
    payload = fetch_json(with_query(api_url(repository, f"contents/{quoted_path}"), ref=revision), token)
    if not isinstance(payload, Mapping) or payload.get("type") != "file":
        raise DatabaseBuildError(f"GitHub contents API did not return a file: {repository}@{revision}:{path}")
    encoded = payload.get("content")
    if not isinstance(encoded, str) or payload.get("encoding") != "base64":
        return ""
    try:
        content = base64.b64decode(encoded, validate=False)
    except (ValueError, TypeError) as error:
        raise DatabaseBuildError(f"invalid base64 content for {repository}@{revision}:{path}") from error
    if len(content) > limit:
        raise DatabaseBuildError(f"external code snapshot exceeds {limit} bytes: {repository}@{revision}:{path}")
    return content.decode("utf-8")


def direct_section(body: str, label: str) -> str:
    section = markdown_section(body, label)
    next_heading = HEADING.search(section)
    return clean_markdown(section[: next_heading.start() if next_heading else None])


def bold_definitions(markdown: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in clean_markdown(markdown).splitlines():
        match = re.match(r"^\s*[-*]\s+\*\*(.+?):\*\*\s*(.*?)\s*$", line)
        if match:
            values[match.group(1).strip()] = match.group(2).strip()
    return values


def first_reference(value: str, repository: str) -> dict[str, Any] | None:
    text = clean_markdown(value)
    if not text or re.fullmatch(r"(?:none|n/a|null)", text, re.I):
        return None
    markdown_link = re.search(r"\[([^\]]+)\]\((https://[^)]+)\)", text)
    if markdown_link:
        url = sanitize_url(markdown_link.group(2))
        return {"label": markdown_link.group(1), "url": url, "raw": text}
    issue = re.search(r"(?:^|\s)#(\d+)\b", text)
    if issue:
        number = int(issue.group(1))
        return {
            "label": f"#{number}",
            "number": number,
            "url": f"https://github.com/{repository}/issues/{number}",
            "raw": f"#{number}",
        }
    url_match = WEB_URL.search(text)
    if url_match:
        url = sanitize_url(url_match.group(0))
        issue_url = re.search(r"/issues/(\d+)$", url)
        record: dict[str, Any] = {"label": url, "url": url, "raw": text}
        if issue_url:
            record["number"] = int(issue_url.group(1))
            record["label"] = f"#{record['number']}"
        return record
    return {"label": text, "url": None, "raw": text}


def references(value: str, repository: str) -> list[dict[str, Any]]:
    text = clean_markdown(value)
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in re.finditer(r"\[([^\]]+)\]\((https://[^)]+)\)", text):
        url = sanitize_url(match.group(2))
        if url and url not in seen:
            seen.add(url)
            found.append({"label": match.group(1), "url": url})
    for match in re.finditer(r"(?:^|\s)#(\d+)\b", text):
        number = int(match.group(1))
        url = f"https://github.com/{repository}/issues/{number}"
        if url not in seen:
            seen.add(url)
            found.append({"label": f"#{number}", "number": number, "url": url})
    for match in WEB_URL.finditer(text):
        url = sanitize_url(match.group(0))
        if url and url not in seen:
            seen.add(url)
            found.append({"label": url, "url": url})
    return found


def checkboxes(markdown: str) -> list[dict[str, Any]]:
    output = []
    for line in clean_markdown(markdown).splitlines():
        match = re.match(r"^\s*[-*]\s+\[([xX ])\]\s+(.+?)\s*$", line)
        if match:
            output.append({"label": match.group(2), "checked": match.group(1).lower() == "x"})
    return output


def common_meta(item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "number": item.get("number"),
        "title": clean_markdown(item.get("title")),
        "state": str(item.get("state") or "unknown").lower(),
        "url": sanitize_url(str(item.get("html_url") or "")),
        "author": (item.get("user") or {}).get("login") if isinstance(item.get("user"), Mapping) else None,
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
        "closed_at": item.get("closed_at"),
        "labels": [label if isinstance(label, str) else label.get("name") for label in item.get("labels", [])],
    }


def parse_issue(
    item: Mapping[str, Any],
    repository: str,
    title_zh_overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    body = str(item.get("body") or "")
    parent = first_reference(direct_section(body, "Parent issue"), repository)
    number = int(item.get("number") or 0)
    return {
        **common_meta(item),
        "architecture_name": direct_section(body, "Architecture Name") or clean_markdown(item.get("title")).removeprefix("[ARCH-PROP]").strip(),
        "title_zh": clean_markdown((title_zh_overrides or {}).get(str(number))),
        "parent_issue": parent,
        "related_work": {
            "text": direct_section(body, "Related work"),
            "references": references(direct_section(body, "Related work"), repository),
        },
        "motivations": direct_section(body, "Motivations"),
        "proposed_architecture": direct_section(body, "Proposed Architecture"),
        "experiments_plan": direct_section(body, "Experiments Plan"),
    }


def commit_record(record: Mapping[str, Any], head_repo: str) -> dict[str, Any]:
    commit = record.get("commit") if isinstance(record.get("commit"), Mapping) else {}
    author = commit.get("author") if isinstance(commit.get("author"), Mapping) else {}
    sha = str(record.get("sha") or "")
    return {
        "sha": sha,
        "message": clean_markdown(str(commit.get("message") or "").splitlines()[0]),
        "author": author.get("name"),
        "authored_at": author.get("date"),
        "url": f"https://github.com/{head_repo}/commit/{sha}" if head_repo and len(sha) == 40 else None,
    }


def file_record(
    record: Mapping[str, Any],
    head_repo: str,
    head_sha: str,
    token: str | None,
) -> dict[str, Any]:
    path = str(record.get("filename") or "")
    quoted_path = quote(path, safe="/")
    content = fetch_repository_text(head_repo, path, head_sha, token) if head_repo and head_sha and path else ""
    return {
        "path": path,
        "status": record.get("status"),
        "additions": record.get("additions"),
        "deletions": record.get("deletions"),
        "blob_sha": record.get("sha"),
        "url": f"https://github.com/{head_repo}/blob/{head_sha}/{quoted_path}",
        **code_snapshot(content),
    }


def parse_pr(
    pull: Mapping[str, Any],
    reviews: list[Mapping[str, Any]],
    commits: list[Mapping[str, Any]],
    files: list[Mapping[str, Any]],
    repository: str,
    token: str | None,
) -> dict[str, Any]:
    body = str(pull.get("body") or "")
    basic = bold_definitions(markdown_section(body, "Basic information"))
    wandb = bold_definitions(markdown_section(body, "W&B Links"))
    head = pull.get("head") if isinstance(pull.get("head"), Mapping) else {}
    base = pull.get("base") if isinstance(pull.get("base"), Mapping) else {}
    head_repo = ((head.get("repo") or {}).get("full_name") if isinstance(head.get("repo"), Mapping) else None) or ""
    head_sha = str(head.get("sha") or "")
    proposal = first_reference(basic.get("Proposal Issue", ""), repository)
    wandb_links = []
    for label in ("W&B Projects Link", "Training Run Link", "Benchmark Run Link"):
        record = first_reference(wandb.get(label, ""), repository)
        if record and record.get("url") and record["url"] not in [item["url"] for item in wandb_links]:
            wandb_links.append({"label": label, "url": record["url"]})
    return {
        **common_meta(pull),
        "draft": bool(pull.get("draft")),
        "merged": bool(pull.get("merged_at")),
        "merged_at": pull.get("merged_at"),
        "architecture_name": clean_markdown(basic.get("Architecture Name")),
        "proposal_issue": proposal,
        "official_model": first_reference(basic.get("Official Model", ""), repository),
        "wandb_links": wandb_links,
        "implementation_summary": direct_section(body, "Implementation Summary"),
        "experiments_summary": direct_section(body, "Experiments Summary"),
        "experiments_outcome": checkboxes(markdown_section(body, "Experiments Outcome")),
        "reproduction_status": checkboxes(markdown_section(body, "Reproduction Status")),
        "conclusion": direct_section(body, "Conclusion"),
        "merge_checklist": checkboxes(markdown_section(body, "Merge Checklist")),
        "base": {
            "repo": ((base.get("repo") or {}).get("full_name") if isinstance(base.get("repo"), Mapping) else None),
            "branch": base.get("ref"),
            "sha": base.get("sha"),
        },
        "head": {"repo": head_repo, "branch": head.get("ref"), "sha": head_sha},
        "commit_count": pull.get("commits"),
        "additions": pull.get("additions"),
        "deletions": pull.get("deletions"),
        "changed_files": pull.get("changed_files"),
        "reviews": [
            {
                "reviewer": (review.get("user") or {}).get("login") if isinstance(review.get("user"), Mapping) else None,
                "state": review.get("state"),
                "submitted_at": review.get("submitted_at"),
            }
            for review in reviews
        ],
        "commits": [commit_record(record, head_repo) for record in commits],
        "files": [file_record(record, head_repo, head_sha, token) for record in files],
    }


def has_label(item: Mapping[str, Any], label: str) -> bool:
    wanted = label.strip().lower()
    return any(
        str(entry if isinstance(entry, str) else entry.get("name") or "").strip().lower() == wanted
        for entry in item.get("labels", [])
    )


def validate_security(document: Mapping[str, Any]) -> None:
    text = json.dumps(document, ensure_ascii=False)
    if CREDENTIAL_VALUE.search(text) or INTERNAL_PATH.search(text):
        raise DatabaseBuildError("model database contains credential material or internal absolute paths")
    if re.search(r"https://wandb\.ai/[^\s\"]+[?#]", text):
        raise DatabaseBuildError("model database contains an unsanitized W&B URL")


def build_database(config: Mapping[str, Any], token: str | None, fetched_at: str) -> dict[str, Any]:
    repository = str(config["source_repository"])
    label = str(config.get("label") or "architecture proposal")
    retained_issue_numbers = {int(number) for number in config.get("retained_issue_numbers", [])}
    title_zh_overrides = config.get("title_zh_overrides") if isinstance(config.get("title_zh_overrides"), Mapping) else {}
    repo = fetch_json(api_url(repository, ""), token)
    default_branch = str(repo.get("default_branch") or "main")
    issue_template_path = ".github/ISSUE_TEMPLATE/architecture-proposal.yml"
    pr_template_path = ".github/pull_request_template.md"
    issue_template = fetch_repository_text(repository, issue_template_path, default_branch, token)
    pr_template = fetch_repository_text(repository, pr_template_path, default_branch, token)
    issue_items = fetch_all_pages(api_url(repository, "issues?state=all"), token)
    pull_items = fetch_all_pages(api_url(repository, "pulls?state=all"), token)
    issues = [
        parse_issue(item, repository, title_zh_overrides)
        for item in issue_items
        if "pull_request" not in item
        and (has_label(item, label) or int(item.get("number") or 0) in retained_issue_numbers)
    ]
    pull_requests = []
    for summary in pull_items:
        if not has_label(summary, label):
            continue
        number = int(summary["number"])
        pull = fetch_json(api_url(repository, f"pulls/{number}"), token)
        reviews = fetch_all_pages(api_url(repository, f"pulls/{number}/reviews"), token)
        commits = fetch_all_pages(api_url(repository, f"pulls/{number}/commits"), token)
        files = fetch_all_pages(api_url(repository, f"pulls/{number}/files"), token)
        pull_requests.append(parse_pr(pull, reviews, commits, files, repository, token))
    document = {
        "schema_version": "1.0.0",
        "database_id": config.get("database_id", "template-test-model-database"),
        "source": {
            "repository": repository,
            "default_branch": default_branch,
            "label": label,
            "fetched_at": fetched_at,
        },
        "mapping": {
            "root_issue_number": int(config["root_issue_number"]),
            "retained_issue_numbers": sorted(retained_issue_numbers),
            "auxiliary_feature_root_id": config["auxiliary_feature_root_id"],
        },
        "templates": {
            "issue": {"path": issue_template_path, "content": issue_template},
            "pull_request": {"path": pr_template_path, "content": pr_template},
        },
        "issues": sorted(issues, key=lambda item: int(item["number"])),
        "pull_requests": sorted(pull_requests, key=lambda item: int(item["number"])),
    }
    validate_security(document)
    return document


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--fetched-at")
    parser.add_argument("--fallback-existing", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        config = load_json(args.config)
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        fetched_at = args.fetched_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        document = build_database(config, token, fetched_at)
        write_json_atomic(args.output, document)
        print(f"DATABASE_OK {args.output} ({len(document['issues'])} models, {len(document['pull_requests'])} PRs)")
        return 0
    except (OSError, KeyError, TypeError, ValueError, OverlayBuildError, DatabaseBuildError) as error:
        if args.fallback_existing and args.output.is_file():
            print(f"WARNING: keeping existing model database after refresh failure: {error}", file=sys.stderr)
            return 0
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
