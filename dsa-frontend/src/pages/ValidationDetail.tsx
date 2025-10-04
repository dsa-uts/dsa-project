import type React from "react";
import type { DetailedTaskLog } from "../types/DetailedTaskLog";
import { decompressFileData, decompressString, type CompressedFileData, type FileData } from "../types/FileData";
import { useParams } from "react-router";
import { useAuthQuery } from "../auth/hooks";
import { useEffect, useMemo, useState } from "react";
import FileViewer from "../components/FileViewer";
import { formatTimestamp } from "../util/timestamp";
import ResultBadge from "../components/ResultBadge";
import DetailedTaskLogTable from "../components/DetailedTaskLogTable";

interface APIResponse {
  id: number;
  ts: number;
  user_id: string;
  user_name: string;
  lecture_id: number;
  problem_id: number;
  lecture_title: string;
  problem_title: string;
  submission_ts: number;
  result_id: number;
  time_ms: number;
  memory_kb: number;
  uploaded_files: CompressedFileData[];
  test_files: CompressedFileData[];
  build_logs: DetailedTaskLog[];
  judge_logs: DetailedTaskLog[];
}

async function decompressTaskLog(log: DetailedTaskLog): Promise<DetailedTaskLog> {
  const [stdin, stdout, stderr, expectedStdout, expectedStderr] = await Promise.all([
    decompressString(log.stdin),
    decompressString(log.stdout),
    decompressString(log.stderr),
    decompressString(log.expected_stdout),
    decompressString(log.expected_stderr),
  ]);

  return {
    ...log,
    stdin: stdin || null,
    stdout,
    stderr,
    expected_stdout: expectedStdout || null,
    expected_stderr: expectedStderr || null,
  };
}

const ValidationDetail: React.FC = () => {
  const { idParam } = useParams<{ idParam: string }>();

  const { data, isLoading, error } = useAuthQuery<APIResponse>({
    queryKey: ['validation-detail', idParam || 'undefined'],
    endpoint: `/problem/result/validation/detail/${idParam}`,
  });

  const processedData = useMemo(async () => {
    if (!data) return null;

    const [uploadedFiles, testFiles, buildLogs, judgeLogs] = await Promise.all([
      Promise.all(data.uploaded_files.map(decompressFileData)),
      Promise.all(data.test_files.map(decompressFileData)),
      Promise.all(data.build_logs.map(decompressTaskLog)),
      Promise.all(data.judge_logs.map(decompressTaskLog)),
    ]);

    return {
      ...data,
      uploadedFiles,
      testFiles,
      buildLogs,
      judgeLogs,
    };
  }, [data]);

  const [decompressedData, setDecompressedData] = useState<{
    uploadedFiles: FileData[];
    testFiles: FileData[];
    buildLogs: DetailedTaskLog[];
    judgeLogs: DetailedTaskLog[];
  } | null>(null);

  useEffect(() => {
    processedData.then(setDecompressedData);
  }, [processedData]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading...</div>
      </div>
    );
  };

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-red-600">
          Error: {error ? error.message : "Data not found"}
        </div>
      </div>
    );
  }

  if (!decompressedData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Decompressing data...</div>
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Validation Result #{data.id}</h1>

      {/* Uploaded Files */}
      {decompressedData.uploadedFiles.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">Uploaded Files</h2>
          <FileViewer files={decompressedData.uploadedFiles} />
        </div>
      )}

      {/* Submission Information */}
      <div className="mb-8 bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <tbody>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100 w-1/3">提出日時</td>
              <td className="px-4 py-2">{formatTimestamp(data.submission_ts)}</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">問題</td>
              <td className="px-4 py-2">
                {data.lecture_title}・{data.problem_title}
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">ユーザ</td>
              <td className="px-4 py-2">
                {data.user_name} ({data.user_id})
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">結果</td>
              <td className="px-4 py-2">
                <ResultBadge resultID={data.result_id} />
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">実行時間</td>
              <td className="px-4 py-2">{data.time_ms} ms</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">メモリ</td>
              <td className="px-4 py-2">{data.memory_kb} KiB</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Build Tasks */}
      {decompressedData.buildLogs.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">Build Tasks</h2>
          <div className="p-4">
            <DetailedTaskLogTable logs={decompressedData.buildLogs} />
          </div>
        </div>
      )}

      {/* Judge Tasks */}
      {decompressedData.judgeLogs.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">Judge Tasks</h2>
          <div className="p-4">
            <DetailedTaskLogTable logs={decompressedData.judgeLogs} />
          </div>
        </div>
      )}

      {/* Test Files */}
      {decompressedData.testFiles.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">用意されたファイル</h2>
          <FileViewer files={decompressedData.testFiles} />
        </div>
      )}
    </div>
  );
};

export default ValidationDetail;
