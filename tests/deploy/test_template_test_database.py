from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from scripts.build_template_test_database import build_database, sanitize_text, sanitize_url


class TemplateTestDatabaseTests(unittest.TestCase):
    def issue(self, number: int, parent: int | None, labels: list[str]) -> dict:
        parent_text = f"#{parent}" if parent else ""
        return {
            "number": number,
            "title": "[ARCH-PROP] Example",
            "state": "open",
            "html_url": f"https://github.com/JT-Ushio/template-test/issues/{number}",
            "user": {"login": "author"},
            "labels": [{"name": label} for label in labels],
            "body": f"""### Architecture Name

Model {number}

### Parent issue

{parent_text}

### Motivations

Test motivation

### Proposed Architecture

Test architecture

### Experiments Plan

Test plan
""",
        }

    def test_zip_retained_issue_survives_live_label_removal(self) -> None:
        config = {
            "database_id": "test",
            "source_repository": "JT-Ushio/template-test",
            "label": "architecture proposal",
            "root_issue_number": 13,
            "retained_issue_numbers": [21],
            "title_zh_overrides": {"13": "根", "21": "保留节点"},
            "auxiliary_feature_root_id": "feat-olmo3-standard",
        }
        issues = [
            self.issue(13, None, ["architecture proposal"]),
            self.issue(21, 13, []),
            self.issue(99, 13, []),
        ]

        def pages(url: str, _token: str | None):
            if "/issues?" in url:
                return issues
            if "/pulls?" in url:
                return []
            self.fail(f"unexpected paginated URL {url}")

        with patch("scripts.build_template_test_database.fetch_json", return_value={"default_branch": "main"}), \
             patch("scripts.build_template_test_database.fetch_repository_text", return_value="template"), \
             patch("scripts.build_template_test_database.fetch_all_pages", side_effect=pages):
            document = build_database(config, None, "2026-07-24T00:00:00+00:00")

        self.assertEqual([13, 21], [issue["number"] for issue in document["issues"]])
        self.assertEqual("保留节点", document["issues"][1]["title_zh"])
        self.assertEqual([21], document["mapping"]["retained_issue_numbers"])

    def test_credentials_queries_and_local_paths_are_removed(self) -> None:
        url = sanitize_url("https://wandb.ai/org/project/runs/abc?accessToken=secret#private")
        self.assertEqual("https://wandb.ai/org/project/runs/abc", url)
        text = sanitize_text("see /home/user/run.log and github_pat_abcdefghijklmnopqrstuvwxyz123456")
        self.assertNotIn("/home/user", text)
        self.assertNotIn("github_pat_", text)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", json.dumps(text))


if __name__ == "__main__":
    unittest.main()
