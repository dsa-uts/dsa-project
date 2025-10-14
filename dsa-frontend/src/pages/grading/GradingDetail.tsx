import { useParams, useSearchParams } from "react-router";
import type { DetailedTaskLog } from "../../types/DetailedTaskLog";
import { decompressFileData, decompressString, type CompressedFileData, type FileData } from "../../types/FileData";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useAuthQuery } from "../../auth/hooks";
import ResultBadge from "../../components/ResultBadge";
import { formatTimestamp } from "../../util/timestamp";
import FileViewer from "../../components/FileViewer";
import DetailedTaskLogTable from "../../components/DetailedTaskLogTable";

interface CompressedFileGroup {
  id: number;
  files: CompressedFileData[];
}

interface FileGroup {
  id: number;
  files: FileData[];
}

interface CompressedTestFilesPerProblem {
  problem_id: number;
  files: CompressedFileData[];
}

interface TestFilesPerProblem {
  problem_id: number;
  files: FileData[];
}

interface ProblemInfo {
  lecture_id: number;
  problem_id: number;
  registered_at: number;
  title: string;
}

interface LectureInfo {
  lecture_id: number;
  title: string;
  start_date: number;
  deadline: number;
  problems: ProblemInfo[];
}

interface GradingDetailPerProblem {
  id: number;
  problem_id: number;
  request_user_id: string;
  request_user_name: string;
  ts: number;
  submission_ts: number;
  result_id: number;
  file_group_id: number;
  time_ms: number;
  memory_kb: number;
  build_logs: DetailedTaskLog[];
  judge_logs: DetailedTaskLog[];
}

interface APIResponse {
  lecture_id: number;
  lecture_info: LectureInfo;
  user_id: string;
  user_name: string;
  file_groups: CompressedFileGroup[];
  test_files_per_problem: CompressedTestFilesPerProblem[];
  detail_list: GradingDetailPerProblem[];
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

async function decompressFileGroup(group: CompressedFileGroup): Promise<FileGroup> {
  const files = await Promise.all(group.files.map(decompressFileData));
  return {
    id: group.id,
    files,
  };
}

async function decompressTestFilesPerProblem(entry: CompressedTestFilesPerProblem): Promise<TestFilesPerProblem> {
  const files = await Promise.all(entry.files.map(decompressFileData));
  return {
    problem_id: entry.problem_id,
    files,
  };
}

async function decompressGradingDetailPerProblem(detail: GradingDetailPerProblem): Promise<GradingDetailPerProblem> {
  const [buildLogs, judgeLogs] = await Promise.all([
    Promise.all(detail.build_logs.map(decompressTaskLog)),
    Promise.all(detail.judge_logs.map(decompressTaskLog)),
  ]);

  return {
    ...detail,
    build_logs: buildLogs,
    judge_logs: judgeLogs,
  };
}

const renderDetail = (detail: GradingDetailPerProblem, fileGroup: FileGroup, testFiles: TestFilesPerProblem, target_username: string, target_userid: string, lectureInfo: LectureInfo): JSX.Element => {

  const problemInfo = lectureInfo.problems.find(problem => problem.problem_id === detail.problem_id) || null;

  return (
    <>
      {/* Submission Information */}
      <div className="mb-8 bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <tbody>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100 w-1/3">提出日時</td>
              <td className="px-4 py-2">{formatTimestamp(detail.submission_ts)}</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">リクエスト日時</td>
              <td className="px-4 py-2">{formatTimestamp(detail.ts)}</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">問題
              </td>
              <td className="px-4 py-2">{problemInfo ? `${lectureInfo.title}・${problemInfo.title}` : '(null)'}</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">採点対象ユーザ</td>
              <td className="px-4 py-2">{target_username} ({target_userid})</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">リクエストユーザ</td>
              <td className="px-4 py-2">{detail.request_user_name} ({detail.request_user_id})</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">結果</td>
              <td className="px-4 py-2">
                <ResultBadge resultID={detail.result_id} />
              </td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">実行時間</td>
              <td className="px-4 py-2">{detail.time_ms} ms</td>
            </tr>
            <tr className="border-b">
              <td className="px-4 py-2 font-semibold bg-gray-100">メモリ</td>
              <td className="px-4 py-2">{detail.memory_kb} KiB</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Uploaded Files */}
      {fileGroup.files.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">Uploaded Files (id: {fileGroup.files.length})</h2>
          <FileViewer files={fileGroup.files} />
        </div>
      )}

      {/* Build Tasks */}
      {detail.build_logs.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">Build Tasks</h2>
          <div className="p-4">
            <DetailedTaskLogTable logs={detail.build_logs} />
          </div>
        </div>
      )}

      {/* Judge Tasks */}
      {detail.judge_logs.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">Judge Tasks</h2>
          <div className="p-4">
            <DetailedTaskLogTable logs={detail.judge_logs} />
          </div>
        </div>
      )}

      {/* Test Files */}
      {testFiles.files.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow">
          <h2 className="text-xl font-semibold p-4 border-b">用意されたファイル</h2>
          <FileViewer files={testFiles.files} />
        </div>
      )}
    </>
  )
}

// url: grading/detail/:lectureid/:userid?id=123
const GradingDetail: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { lectureid, userid } = useParams<{ lectureid: string; userid: string }>();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const pollingIntervalRef = useRef<number | null>(null);

  const { data: apiResponse, isLoading: isLoadingApiResponse, isError: isErrorApiResponse } = useAuthQuery<APIResponse>({
    queryKey: ['gradingDetail', lastUpdate.toString()],
    endpoint: `/problem/result/grading/summary/${lectureid}/${userid}`,
    options: {
      queryOptions: {
        retry: 1,
      }
    }
  });

  const processedData = useMemo(async () => {
    if (!apiResponse) return null;

    const [fileGroups, testFilesPerProblem, detailList] = await Promise.all([
      Promise.all(apiResponse.file_groups.map(decompressFileGroup)),
      Promise.all(apiResponse.test_files_per_problem.map(decompressTestFilesPerProblem)),
      Promise.all(apiResponse.detail_list.map(decompressGradingDetailPerProblem))
    ]);

    return {
      fileGroups,
      testFilesPerProblem,
      detailList,
    };
  }, [apiResponse]);

  const [decompressedData, setDecompressedData] = useState<{
    fileGroups: FileGroup[];
    testFilesPerProblem: TestFilesPerProblem[];
    detailList: GradingDetailPerProblem[];
  } | null>(null);

  useEffect(() => {
    processedData.then(setDecompressedData);
  }, [processedData]);

  // Initialize selectedId from URL query parameter
  useEffect(() => {
    const idParam = searchParams.get('id');
    if (!idParam) return;

    const id = parseInt(idParam, 10);

    if (isNaN(id)) return;

    setSelectedId(id);
  }, []);

  // Start or stop polling whenever pending results remain
  useEffect(() => {
    if (!apiResponse) {
      // Clear any existing interval if apiResponse is not ready
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Check if there are any pending results
    const hasPending = apiResponse.detail_list.some(detail =>
      detail.result_id === 9 || detail.result_id === 10);

    if (hasPending) {
      console.log("Found pending results, starting polling...");

      // Clear any existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      // Start polling every 5 seconds
      pollingIntervalRef.current = setInterval(() => {
        setLastUpdate(Date.now());
      }, 5000);
    } else {
      // No pending results, clear interval if it exists
      if (pollingIntervalRef.current) {
        console.log("No pending results, stopping polling.");
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [apiResponse]);

  if (!lectureid || !userid) {
    return <div className="container mx-auto px-8 py-6">Invalid parameters.</div>;
  }

  if (isLoadingApiResponse) {
    return <div className="container mx-auto px-8 py-6">Loading...</div>;
  }

  if (!decompressedData) {
    return <div className="container mx-auto px-8 py-6">Processing data...</div>;
  }

  if (isErrorApiResponse || !apiResponse) {
    return <div className="container mx-auto px-8 py-6">Error loading data.</div>;
  }


  // Function to get stored results for a specific problem_id
  const getDetailsByProblemId = (problem_id: number): GradingDetailPerProblem[] => {
    return decompressedData.detailList
      .filter(detail => detail.problem_id === problem_id)
      .sort((a, b) => b.submission_ts - a.submission_ts); // Sort by submission timestamp descending
  }

  const currentLecture = apiResponse.lecture_info;

  const currentDetail = selectedId
    ? decompressedData.detailList.find(detail => detail.id === selectedId) || null
    : null;

  const fileGroup = currentDetail ?
    decompressedData.fileGroups.find(group => group.id === currentDetail.file_group_id) || null
    : null;

  const testFiles = currentDetail ?
    decompressedData.testFilesPerProblem.find(entry => entry.problem_id === currentDetail.problem_id) || null
    : null;

  return (
    <div className="container mx-auto px-8 py-6">
      <h1 className="text-3xl font-semibold mb-6">Grading Detail</h1>

      <div className="bg-white rounded-lg shadow overflow-x-auto mb-8">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-r">
                名前 (学籍番号)
              </th>
              {currentLecture.problems.map((problem, index) => {
                const isLast = index === currentLecture.problems.length - 1;

                return <th key={problem.problem_id} className={`px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider ${isLast ? '' : 'border-r'}`}>
                  {problem.title}
                </th>;
              })}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            <tr>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-r">
                {apiResponse.user_name} ({apiResponse.user_id})
              </td>
              {currentLecture.problems.map((problem, index) => {
                const results = getDetailsByProblemId(problem.problem_id);
                const isLast = index === currentLecture.problems.length - 1;

                return (
                  <td key={problem.problem_id} className={`px-6 py-4 text-sm text-gray-500 ${isLast ? '' : 'border-r'}`}>
                    {results.length === 0 ? (
                      <div className="text-center">
                        <span className="text-gray-400">-</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {results.map(result => {
                          const isDelay = result.submission_ts > currentLecture.deadline;

                          return <div
                            key={result.id}
                            className={`flex items-center gap-2 hover:border-2 hover:border-blue-300 rounded-lg px-1 py-1 ${selectedId === result.id ? 'bg-blue-100 border-2 border-blue-400' : 'cursor-pointer'
                              }`}
                            onClick={() => {
                              setSelectedId(result.id);
                              setSearchParams({ id: result.id.toString() });
                            }}
                          >
                            <ResultBadge resultID={result.result_id} />
                            <span className={`text-xs ${isDelay ? 'text-red-600' : 'text-gray-600'}`}>
                              {formatTimestamp(result.submission_ts)}
                              {isDelay && <span className="text-red-600"> (Late)</span>}
                            </span>
                          </div>
                        })}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {!(currentDetail && fileGroup && testFiles) ? (
        <div className="text-gray-500 text-center mt-24">No entry selected.</div>
      ) : (
        renderDetail(currentDetail, fileGroup, testFiles, apiResponse.user_name, apiResponse.user_id, apiResponse.lecture_info)
      )}
    </div>
  );
}

export default GradingDetail;
