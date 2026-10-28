"""Check the Nu workflow without starting Docker: python3 scripts/test_e2e.py."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class WorkflowTest(unittest.TestCase):
    def test_workflow(self):
        for action, failure in (("run", ""), ("run", "setup"), ("run", "test"), ("test", "")):
            with self.subTest(action=action, failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "scripts").mkdir()
                (root / "e2e").mkdir()
                shutil.copy(Path(__file__).with_name("e2e.nu"), root / "scripts/e2e.nu")
                binaries = root / "bin"
                binaries.mkdir()
                for command in ("docker", "npm"):
                    executable = binaries / command
                    executable.write_text(
                        '#!/bin/sh\n'
                        'echo "$(basename "$0") $*" >> "$EVENTS"\n'
                        'echo "command output"\n'
                        'case "$*" in\n'
                        '  *" up "*) [ "$FAILURE" = setup ] && exit 7 ;;\n'
                        '  "test "*) [ "$FAILURE" = test ] && exit 8 ;;\n'
                        'esac\nexit 0\n'
                    )
                    executable.chmod(0o755)
                result = subprocess.run(
                    ["nu", "--no-config-file", str(root / "scripts/e2e.nu"), action,
                     "--headed", "tests/login.spec.ts"],
                    env={**os.environ, "PATH": f"{binaries}:{os.environ['PATH']}",
                         "EVENTS": str(root / "events"), "FAILURE": failure},
                    capture_output=True, text=True,
                )
                events = (root / "events").read_text().splitlines()
                artifacts = next((root / "e2e/artifacts").iterdir())
                self.assertEqual(result.returncode == 0, not failure, result.stderr)
                self.assertTrue((artifacts / "compose.log").is_file())
                self.assertTrue(all("-p dsa-e2e" in e for e in events if e.startswith("docker")))
                downs = sum(" down --volumes" in e for e in events)
                self.assertEqual(downs, 0 if action == "test" else 1 if failure else 2)
                if failure != "setup":
                    self.assertIn("npm test -- --headed tests/login.spec.ts", events)
                    self.assertIn("command output", (artifacts / "test.log").read_text())
                else:
                    self.assertFalse(any(e.startswith("npm") for e in events))
                if action == "run" and not failure:
                    self.assertIn("logs --no-color --timestamps", events[-2])
                    self.assertIn("down --volumes", events[-1])
                else:
                    self.assertIn("logs --no-color --timestamps", events[-1])


if __name__ == "__main__":
    unittest.main()
