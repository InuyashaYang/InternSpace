from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_template_test_overlay import build_overlay, write_json_atomic


class TemplateTestOverlayTests(unittest.TestCase):
    def config(self) -> dict:
        return {
            "overlay_id": "template-test-overlay",
            "source_repository": "JT-Ushio/template-test",
            "submissions": [
                {
                    "issue_number": 3,
                    "pull_request_number": 5,
                    "maps_to_feature_id": "feat-olmo3-standard",
                    "merge_strategy": "external-display-local-structure",
                    "title_zh": "OLMo-2 1B 基础架构",
                    "summary_zh": "测试叠图",
                    "temporary_equivalence": {
                        "external": "olmo2-0425-1b",
                        "local": "feat-olmo3-standard",
                        "assumption": "Temporary visualization alias only.",
                    },
                    "replaces_experiment_id": "exp-local-reference",
                }
            ],
        }

    def issue(self) -> dict:
        return {
            "number": 3,
            "title": "[ARCH-PROP] OLMo2-1B Base Architecture",
            "html_url": "https://github.com/JT-Ushio/template-test/issues/3",
            "state": "open",
            "updated_at": "2026-07-22T11:06:37Z",
            "user": {"login": "Feanus"},
            "body": """### Architecture ID

OLMo2-0425-1B

### Proposal type

Root architecture

### Evidence and references

https://arxiv.org/pdf/2501.00656

### Motivation

**Research hypothesis**
A pinned local implementation can serve as a reproducible baseline.
""",
        }

    def pull_request(self) -> dict:
        return {
            "number": 5,
            "title": "OLMo-2 1B Base Architecture",
            "html_url": "https://github.com/JT-Ushio/template-test/pull/5",
            "state": "open",
            "updated_at": "2026-07-22T12:28:06Z",
            "user": {"login": "scv11"},
            "head": {
                "sha": "c1390d4637c448e2574057f819e6f42884d2ccec",
                "repo": {
                    "full_name": "scv11/template-test-olmo2",
                    "html_url": "https://github.com/scv11/template-test-olmo2",
                },
            },
            "body": """## Implementation Summary

Add an OLMo2 baseline implementation.

### Model Configuration

| Field | Value |
|---|---:|
| Number of layers | 16 |
| Hidden size | 2048 |

### W&B Links

https://wandb.ai/example/project/runs/abc123?accessToken=fake-test-value

### Training Summary

| Metric | Result |
|---|---:|
| Initial training loss | 10.42 |
| Final training loss | 3.18 |
| Average throughput | 38.6k tokens/s |

## Benchmark Results

| Benchmark | Metric | Score |
|---|---|---:|
| SciQ | Accuracy | `<value>` |
""",
        }

    def test_builds_sanitized_dual_identity_overlay(self) -> None:
        files = [{
            "filename": "models/olmo2/modeling_olmo2.py",
            "sha": "a" * 40,
            "status": "added",
            "additions": 12,
            "deletions": 0,
            "_content": "class Olmo2Model:\n    def forward(self, input_ids):\n        return input_ids\n",
        }]
        commits = [{
            "sha": "b" * 40,
            "html_url": f"https://github.com/scv11/template-test-olmo2/commit/{'b' * 40}",
            "commit": {
                "message": "add olmo2 modeling files",
                "author": {"name": "scv11", "date": "2026-07-22T12:22:35Z"},
            },
        }]
        document = build_overlay(
            self.config(),
            {(3, 5): (self.issue(), self.pull_request(), files, commits)},
            "2026-07-23T00:00:00+00:00",
        )
        node = document["nodes"][0]
        experiment = document["experiments"][0]
        self.assertEqual("feat-olmo3-standard", node["maps_to_feature_id"])
        self.assertEqual("olmo2-0425-1b", node["external_architecture_id"])
        self.assertEqual(16, node["model_configuration"]["number_of_layers"])
        self.assertIn("scv11/template-test-olmo2/blob/c1390d", node["implementation_files"][0]["url"])
        self.assertEqual(["Olmo2Model", "forward"], node["implementation_files"][0]["symbols"])
        self.assertEqual(64, len(node["implementation_files"][0]["content_sha256"]))
        self.assertIn("class Olmo2Model", node["implementation_files"][0]["excerpt"])
        self.assertEqual("add olmo2 modeling files", node["commits"][0]["message"])
        self.assertEqual("https://wandb.ai/example/project/runs/abc123", experiment["wandb_url"])
        self.assertEqual(3.18, experiment["final_metrics"]["final_training_loss"])
        self.assertEqual(38600, experiment["final_metrics"]["average_throughput"])
        self.assertNotIn("accessToken", json.dumps(document, ensure_ascii=False))
        self.assertNotIn("fake-test-value", json.dumps(document, ensure_ascii=False))

    def test_atomic_output_contains_no_raw_submission_body(self) -> None:
        document = build_overlay(
            self.config(),
            {(3, 5): (self.issue(), self.pull_request(), [], [])},
            "2026-07-23T00:00:00+00:00",
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "overlay.json"
            write_json_atomic(path, document)
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("accessToken", text)
            self.assertNotIn("<value>", text)
            self.assertIn("Temporary visualization alias only", text)


if __name__ == "__main__":
    unittest.main()
