import React from "react";
import type { DetailedTaskLog } from "../types/DetailedTaskLog";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import ResultBadge from "./ResultBadge";
import { DiffEditor } from "@monaco-editor/react";

interface DetailedTaskLogTableProps {
  logs: DetailedTaskLog[];
}

const DetailedTaskLogTable: React.FC<DetailedTaskLogTableProps> = ({ logs }) => {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [diffMode, setDiffMode] = useState<{ [key: string]: boolean }>({});

  const toggleRow = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  const toggleDiffMode = (key: string) => {
    setDiffMode((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const exitCodeColor = (exitCode: number, expectedExitCode: number, ignoreExit: boolean) => {
    if (ignoreExit) {
      return "text-gray-600";
    }

    if (exitCode === 0 && expectedExitCode !== 0) {
      // Expected failure but got success
      return "text-red-600";
    }
    if (exitCode !== 0 && expectedExitCode === 0) {
      // Expected success but got failure
      return "text-red-600";
    }
    return "text-green-600";
  }

  return (
    <div className="w-full">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-300">
            <th className="p-2 text-left w-10"></th>
            <th className="p-2 text-left">説明</th>
            <th className="p-2 text-center w-24">結果</th>
            <th className="p-2 text-right w-24">実行時間</th>
            <th className="p-2 text-right w-32">メモリ</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, index) => (
            <React.Fragment key={index}>
              <tr
                onClick={() => toggleRow(index)}
                className="border-b border-gray-200 hover:bg-gray-50"
              >
                <td className="p-2">
                  <button
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${expandedRows.has(index) ? "rotate-180" : ""}`} />
                  </button>
                </td>
                <td className="p-2">{log.description}</td>
                <td className="p-2 text-center">
                  <ResultBadge resultID={log.result_id} />
                </td>
                <td className="p-2 text-right">{log.time_ms} ms</td>
                <td className="p-2 text-right">{log.memory_kb} KiB</td>
              </tr>

              {expandedRows.has(index) && (
                <tr>
                  <td colSpan={5} className="bg-gray-50 p-4 border-b border-gray-200">
                    <div className="space-y-4">
                      {/* Test Case Info */}
                      <div className="grid grid-cols-1 gap-2 text-sm">
                        <div>
                          <span className="font-semibold">Task #</span>
                          <span>{log.test_case_id}</span>
                        </div>
                        <div>
                          <span className="font-semibold">Exit code: </span>
                          <span className={exitCodeColor(log.exit_code, log.expected_exit_code, log.ignore_exit)}>
                            {log.exit_code} ({log.ignore_exit ? "no expected exit code" : "expected: " + log.expected_exit_code})
                          </span>
                        </div>
                        <div>
                          <span className="font-semibold">Command: </span>
                          <span className="bg-gray-200 font-mono p-1 rounded">{log.command}</span>
                        </div>
                      </div>

                      {/* Standard Input */}
                      <div>
                        <h4 className="font-semibold">標準入力 (stdin)</h4>
                        <div className="bg-white border border-gray-300 rounded p-2 max-h-40 overflow-auto">
                          <pre className="text-sm font-mono whitespace-pre-wrap">
                            {log.stdin || "(No stdin)"}
                          </pre>
                        </div>
                      </div>

                      {/* Standard Output */}
                      <div>
                        <div className="flex items-center gap-4 mb-2">
                          <h4 className="font-semibold">標準出力 (stdout)</h4>
                          {log.expected_stdout && (
                            <button
                              onClick={() => toggleDiffMode(`stdout-${index}`)}
                              className="text-sm bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                            >
                              {diffMode[`stdout-${index}`] ? 'Normal View' : 'Diff View'}
                            </button>
                          )}
                        </div>

                        {diffMode[`stdout-${index}`] && log.expected_stdout ? (
                          <div className="border border-gray-300 rounded overflow-hidden">
                            <DiffEditor
                              height="200px"
                              original={log.stdout}
                              modified={log.expected_stdout}
                              language="plaintext"
                              originalLanguage="plaintext"
                              modifiedLanguage="plaintext"
                              options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                renderSideBySide: true,
                              }}
                              keepCurrentModifiedModel={true}
                              keepCurrentOriginalModel={true}
                            />
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-xs text-gray-600 mb-1">標準出力 (stdout)</div>
                              <div className="bg-white border border-gray-300 rounded p-2 max-h-40 overflow-auto">
                                <pre className="text-sm font-mono whitespace-pre-wrap">
                                  {log.stdout}
                                </pre>
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-600 mb-1">標準出力 (stdout, expected)</div>
                              <div className="bg-white border border-gray-300 rounded p-2 max-h-40 overflow-auto">
                                <pre className="text-sm font-mono whitespace-pre-wrap">
                                  {log.expected_stdout === null ? "(No expected stdout)" : log.expected_stdout}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Standard Error */}
                      <div>
                        <div className="flex items-center gap-4 mb-2">
                          <h4 className="font-semibold">標準エラー出力 (stderr)</h4>
                          {log.expected_stderr && (
                            <button
                              onClick={() => toggleDiffMode(`stderr-${index}`)}
                              className="text-sm bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                            >
                              {diffMode[`stderr-${index}`] ? 'Normal View' : 'Diff View'}
                            </button>
                          )}
                        </div>

                        {diffMode[`stderr-${index}`] && log.expected_stderr ? (
                          <div className="border border-gray-300 rounded overflow-hidden">
                            <DiffEditor
                              height="200px"
                              original={log.stderr}
                              modified={log.expected_stderr}
                              language="plaintext"
                              originalLanguage="plaintext"
                              modifiedLanguage="plaintext"
                              options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                renderSideBySide: true,
                              }}
                            />
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-xs text-gray-600 mb-1">標準エラー出力 (stderr)</div>
                              <div className="bg-white border border-gray-300 rounded p-2 max-h-40 overflow-auto">
                                <pre className="text-sm font-mono whitespace-pre-wrap">
                                  {log.stderr}
                                </pre>
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-600 mb-1">標準エラー出力 (stderr, expected)</div>
                              <div className="bg-white border border-gray-300 rounded p-2 max-h-40 overflow-auto">
                                <pre className="text-sm font-mono whitespace-pre-wrap">
                                  {log.expected_stderr === null ? "(No expected stderr)" : log.expected_stderr}
                                </pre>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DetailedTaskLogTable;
