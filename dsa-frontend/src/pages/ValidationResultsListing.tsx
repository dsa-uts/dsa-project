import type React from "react";
import { formatTimestamp } from "../util/timestamp";
import ResultBadge from "../components/ResultBadge";
import { addAuthorizationHeader, useAuthQuery } from "../auth/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { axiosClient } from "../api/axiosClient";
import { Link } from "react-router";

interface ValidationResult {
  id: number;
  ts: number;
  user_id: string;
  user_name: string;
  lecture_id: number;
  problem_id: number;
  result_id: number;
  time_ms: number;
  memory_kb: number;
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

interface APIResponse {
  results: ValidationResult[];
  lecture_info: LectureInfo[];
}

const ValidationResultsListing: React.FC = () => {
  const [anchor, setAnchor] = useState<number>(15000000);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [currentData, setCurrentData] = useState<APIResponse | null>(null);
  const intervalRef = useRef<number | null>(null);

  // API call using useAuthQuery
  const { data, isLoading, error } = useAuthQuery<APIResponse>({
    queryKey: ['validationResults', `${anchor}`, `${direction}`],
    endpoint: `/problem/result/validation/list?anchor=${anchor}&direction=${direction}`,
    options: {
      queryOptions: {
        enabled: true,
        staleTime: 0, // always fetch fresh data
      }
    }
  })

  // Update currentData when new data is fetched
  useEffect(() => {
    if (data && data.results && data.results.length > 0) {
      setCurrentData(data);
    }
  }, [data]);

  // Function to fetch individual result
  const fetchIndividualResult = useCallback(async (resultId: number) => {
    try {
      // Using axios with authorization header directly
      const config = addAuthorizationHeader(undefined);
      const response = await axiosClient.get<ValidationResult>(
        `/problem/result/validation/${resultId}`,
        config
      );

      const updatedResult = response.data;

      // Update the specific result in currentData
      setCurrentData(prevData => {
        if (!prevData) return prevData;

        return {
          ...prevData,
          results: prevData.results.map(r =>
            r.id === resultId ? updatedResult : r
          )
        };
      });
    } catch (error) {
      console.error(`Failed to fetch result ${resultId}:`, error);
      // Optionally, remove the ID from judgingIds if the fetch fails repeatedly
      // This prevents infinite retries for deleted or invalid results
    }
  }, []);

  // Set up polling for judging results
  useEffect(() => {
    // Clear existing interval
    if (intervalRef.current) {
      console.log("clearing existing interval: ", intervalRef.current);
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // calculate judging IDs
    if (!currentData) return;
    const judgingIds = currentData.results
      .filter(r => r.result_id === 9 || r.result_id === 10)
      .map(r => r.id);

    console.log("Current judging IDs: ", judgingIds);

    // If there are judging results, set up polling
    if (judgingIds.length > 0) {
      intervalRef.current = setInterval(() => {
        judgingIds.forEach(id => {
          fetchIndividualResult(id);
        });
      }, 3000); // Poll every 3 seconds
      console.log("interval set for judging results: ", intervalRef.current);
    }

    // Cleanup on unmount or when judgingIds change
    return () => {
      if (intervalRef.current) {
        console.log("clearing interval: ", intervalRef.current);
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [currentData, fetchIndividualResult]);

  const getProblemTitle = (lectureId: number, problemId: number): string => {
    if (!currentData) return "Unknown";
    const lecture = currentData.lecture_info.find(l => l.lecture_id === lectureId);
    if (!lecture) return "Unknown";
    const problem = lecture.problems.find(p => p.problem_id === problemId);
    if (!problem) return "Unknown";
    return `${lecture.title} · ${problem.title}`;
  }

  const handleNextPage = async () => {
    if (!currentData || !currentData.results || currentData.results.length === 0) return;

    // Get the smallest ID (oldest entry) from current data
    const minId = Math.min(...currentData.results.map(r => r.id));

    // Update pagination parameters
    setAnchor(minId);
    setDirection("next");

    // Refetch will be triggered automatically by useAuthQuery due to queryKey change
  };

  const handlePrevPage = async () => {
    if (!currentData || !currentData.results || currentData.results.length === 0) return;

    // Get the largest ID (newest entry) from current data
    const maxId = Math.max(...currentData.results.map(r => r.id));

    // Update pagination parameters
    setAnchor(maxId);
    setDirection("prev");

    // Refetch will be triggered automatically by useAuthQuery due to queryKey change
  };

  if (isLoading && !currentData) {
    return (
      <div className="container mx-auto px-8 py-6">
        <h1 className="text-3xl font-semibold mb-6">Validation Results</h1>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-600">Loading...</div>
        </div>
      </div>
    )
  }

  if (error && !currentData) {
    return (
      <div className="container mx-auto px-8 py-6">
        <h1 className="text-3xl font-semibold mb-6">Validation Results</h1>
        <div className="flex justify-center items-center h-64">
          <div className="text-red-600">Error loading data.</div>
        </div>
      </div>
    )
  }

  if (!currentData || !currentData.results || currentData.results.length === 0) {
    return (
      <div className="container mx-auto px-8 py-6">
        <h1 className="text-3xl font-semibold mb-6">Validation Results</h1>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-600">No validation results available.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-8 py-6">
      <h1 className="text-3xl font-semibold mb-6">Validation Results</h1>

      {/* Warning Message */}
      <div className="bg-white border-2 border-red-500 rounded-lg p-4 mb-6">
        <p className="text-sm">注） ここで行った提出で、採点はされません。</p>
        <p className="text-sm">注） ここでアクセプトされても、アルゴリズムが正しいことの保証にはなりません。採点時にはさらに厳しいテストケースが用意されています。</p>
        <p className="text-sm">注） レポート含め問題無く採点可能であることを確認した後、manabaで提出してください。</p>
        <p className="text-sm">注） 提出してから一週間程度で結果は削除されます。</p>
      </div>

      {/* Pagination - Top */}
      <div className="flex justify-center mb-4 gap-4">
        <button
          onClick={handlePrevPage}
          className="text-gray-500 hover:text-gray-700"
          disabled={isLoading}>
          &lt; Prev
        </button>
        <button
          onClick={handleNextPage}
          className="text-blue-500 hover:text-blue-700"
          disabled={isLoading}>
          Next &gt;
        </button>
      </div>

      {/* Table */}
      <div className="bg-white shadow-sm border border-gray-300">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="border-r border-gray-400 px-4 py-3 text-left font-semibold">提出日時</th>
              <th className="border-r border-gray-400 px-4 py-3 text-left font-semibold">問題</th>
              <th className="border-r border-gray-400 px-4 py-3 text-left font-semibold">ユーザ</th>
              <th className="border-r border-gray-400 px-4 py-3 text-left font-semibold">結果</th>
              <th className="border-r border-gray-400 px-4 py-3 text-left font-semibold">実行時間</th>
              <th className="border-r border-gray-400 px-4 py-3 text-left font-semibold">メモリ</th>
              <th className="px-4 py-3 text-center font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {currentData.results.map((result, index) => (
              <tr key={`result-${result.id}`} className={`border-b border-gray-400 ${index % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                <td className="border-r border-gray-400 px-4 py-3 text-sm">
                  {formatTimestamp(result.ts)}
                </td>
                <td className="border-r border-gray-400 px-4 py-3 text-sm">
                  <Link to={`/problem/${result.lecture_id}/${result.problem_id}`} className="text-blue-500 hover:text-blue-700 underline">
                    {getProblemTitle(result.lecture_id, result.problem_id)}
                  </Link>
                </td>
                <td className="border-r border-gray-400 px-4 py-3 text-sm">
                  {result.user_name} ({result.user_id})
                </td>
                <td className="border-r border-gray-400 px-4 py-3 text-sm">
                  <div className="flex justify-center">
                    <ResultBadge resultID={result.result_id} />
                  </div>
                </td>
                <td className="border-r border-gray-400 px-4 py-3 text-sm">
                  {result.time_ms} ms
                </td>
                <td className="border-r border-gray-400 px-4 py-3 text-sm">
                  {result.memory_kb} KiB
                </td>
                <td className="px-4 py-3 text-center">
                  {/* Link to detail page /validation/detail/:id */}
                  <Link
                    to={`/validation/detail/${result.id}`}
                    className="text-blue-500 hover:text-blue-700 underline text-sm">
                    詳細
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination - Top */}
      <div className="flex justify-center mt-4 gap-4">
        <button
          onClick={handlePrevPage}
          className="text-gray-500 hover:text-gray-700"
          disabled={isLoading}>
          &lt; Prev
        </button>
        <button
          onClick={handleNextPage}
          className="text-blue-500 hover:text-blue-700"
          disabled={isLoading}>
          Next &gt;
        </button>
      </div>
    </div>
  )
}

export default ValidationResultsListing;