import { useSearchParams } from "react-router";
import { addAuthorizationHeader, useAuthQuery } from "../../auth/hooks";
import { useEffect, useRef, useState } from "react";
import ResultBadge from "../../components/ResultBadge";
import { formatTimestamp } from "../../util/timestamp";
import { axiosClient } from "../../api/axiosClient";

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

interface GradingResult {
  id: number;
  problem_id: number;
  result_id: number;
  submission_ts: number;
  time_ms: number;
  memory_kb: number;
}

interface UserInfo {
  user_id: string;
  user_name: string;
  results: GradingResult[];
}

interface APIResponse {
  lecture_info: LectureInfo;
  detail: UserInfo[];
}

// url: /grading/results?lectureid=xxx
const GradingResultsListing: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [lectureId, setLectureId] = useState<number | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);

  const { data: lectureList, isLoading: lectureListLoading, isError: lectureListError } = useAuthQuery<LectureInfo[]>({
    queryKey: ['lectureList'],
    endpoint: '/problem/fetch/list',
    options: {
      queryOptions: {
        retry: 2,
      }
    }
  });
  const [apiResponse, setApiResponse] = useState<APIResponse | null>(null);

  const fetchGradingResults = async (lectureId: number) => {
    try {
      const config = addAuthorizationHeader({});
      const response = await axiosClient.get<APIResponse>(
        `/problem/result/grading/list/${lectureId}`,
        config,
      );
      if (response.status !== 200) {
        throw new Error(`Failed to fetch grading results: ${response.statusText}`);
      }
      setApiResponse(response.data);
    } catch (error) {
      console.error("Error fetching grading results:", error);
      setApiResponse(null);
    }
  };

  const fetchIndividualGradingResult = async (lectureId: number, resultId: number) => {
    try {
      const config = addAuthorizationHeader({});
      const response = await axiosClient.get<GradingResult>(
        `/problem/result/grading/entry/${lectureId}/${resultId}`,
        config,
      );
      if (response.status !== 200) {
        throw new Error(`Failed to fetch individual grading result: ${response.statusText}`);
      }
      return response.data;
    } catch (error) {
      console.error("Error fetching individual grading result:", error);
    }
    return null;
  }

  // Function to check and update pending results
  const updatePendingResults = async () => {
    if (!apiResponse || !lectureId) return;

    const pendingResults: { userId: string; result: GradingResult }[] = [];

    // Find all results with status 9 (Judging) or 10 (Wait for Judging)
    apiResponse.detail.forEach(user => {
      user.results.forEach(result => {
        if (result.result_id === 9 || result.result_id === 10) {
          pendingResults.push({ userId: user.user_id, result });
        }
      });
    });

    if (pendingResults.length === 0) {
      // No pending results, stop polling
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        console.log("All results judged, stopping polling.");
      }
      return;
    }

    console.log(`Update ${pendingResults.length} pending results...`);

    // Fetch updates for each pending result
    const updates = await Promise.all(
      pendingResults.map(async ({ userId, result }) => {
        const updated = await fetchIndividualGradingResult(lectureId, result.id);
        return { userId, originalId: result.id, updated };
      })
    );

    setApiResponse(prev => {
      if (!prev) return null;

      const newDetail = prev.detail.map(user => {
        const userUpdates = updates.filter(u => u.userId === user.user_id);

        if (userUpdates.length === 0) return user;

        const updatedResults = user.results.map(result => {
          const update = userUpdates.find(u => u.originalId === result.id);
          if (update && update.updated) {
            // Keep the original id but update other fields
            return {
              ...result,
              result_id: update.updated.result_id,
              time_ms: update.updated.time_ms,
              memory_kb: update.updated.memory_kb,
            };
          }

          return result;
        });

        return { ...user, results: updatedResults };
      });

      return { ...prev, detail: newDetail };
    });
  };

  // Start or stop polling based on pending results
  useEffect(() => {
    if (!apiResponse || !lectureId) {
      // Clear any existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Check if there are any pending results
    const hasPendingResults = apiResponse.detail.some(user =>
      user.results.some(result => result.result_id === 9 || result.result_id === 10)
    );

    if (hasPendingResults) {
      console.log("Found pending results, starting polling...");

      // Clear any existing interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      // Start polling every 5 seconds
      pollingIntervalRef.current = setInterval(() => {
        updatePendingResults();
      }, 5000);

      // Initial immediate check
      updatePendingResults();
    } else {
      // No pending results, clear interval if exists
      if (pollingIntervalRef.current) {
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
  }, [apiResponse, lectureId]);

  // Initialize lectureId from URL params on mount
  useEffect(() => {
    const lectureIdParam = searchParams.get("lectureid");
    if (lectureIdParam) {
      const id = parseInt(lectureIdParam);

      if (isNaN(id)) {
        setLectureId(null);
        return;
      }
      setLectureId(id);

      // fetch results data for this lectureId
      fetchGradingResults(id);
    }
  }, []);


  // Update URL when lectureId changes
  useEffect(() => {
    if (lectureId !== null) {
      setSearchParams({ lectureid: lectureId.toString() });
    }
  }, [lectureId]);

  const handleLectureChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = parseInt(e.target.value);
    if (!isNaN(selectedId)) {
      setLectureId(selectedId);
      fetchGradingResults(selectedId);
    }
  };

  if (lectureListLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading lectures...</div>
      </div>
    );
  }

  if (lectureListError || !lectureList) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">Error loading lecture list.</div>
      </div>
    );
  }

  if (lectureList.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">No lectures available.</div>
      </div>
    );
  }

  const currentLecture = apiResponse?.lecture_info;
  const userData = apiResponse?.detail;

  // Function to get stored results for a specific user and problem
  const getUserProblemResults = (user: UserInfo, problemId: number): GradingResult[] => {
    return user.results
      .filter(result => result.problem_id === problemId)
      .sort((a, b) => b.submission_ts - a.submission_ts); // Sort by submission time desc
  };

  return (
    <div className="container mx-auto px-8 py-6">
      <h1 className="text-3xl font-semibold mb-6">Grading Results</h1>

      {/* Dropdown Selection */}
      <div className="mb-6">
        <select
          value={lectureId || ''}
          onChange={handleLectureChange}
          className="px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
        >
          <option value="" disabled>Select a lecture</option>
          {lectureList.map(lecture => (
            <option key={lecture.lecture_id} value={lecture.lecture_id}>
              {lecture.lecture_id}: {lecture.title}
            </option>
          ))}
        </select>
      </div>

      {/* Results Table */}
      {currentLecture && userData && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                  名前 (学籍番号)
                </th>
                {currentLecture.problems.map((problem, index) => {
                  const isLast = index === currentLecture.problems.length - 1;

                  return <th key={problem.problem_id} className={`px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider ${isLast ? '' : 'border-r'}`}>
                    {problem.title}
                  </th>
                })}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {userData.map(user => (
                <tr key={user.user_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 border-r">
                    {user.user_name} ({user.user_id})
                  </td>
                  {currentLecture.problems.map((problem, index) => {
                    const results = getUserProblemResults(user, problem.problem_id);
                    const isLast = index === currentLecture.problems.length - 1;

                    return (
                      <td key={problem.problem_id} className={`px-6 py-4 text-sm text-gray-500 ${isLast ? '' : 'border-r'}`}>
                        {results.length === 0 ? (
                          <div className="text-center">
                            <span className="text-gray-400">-</span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {results.map(result => (
                              <div key={result.id} className="flex items-center gap-2">
                                <ResultBadge resultID={result.result_id} />
                                <span className={`text-xs ${result.submission_ts > currentLecture.deadline ? 'text-red-600' : 'text-gray-600'}`}>
                                  {formatTimestamp(result.submission_ts)}
                                  {result.submission_ts > currentLecture.deadline && (
                                    <span className="ml-1">(Late)</span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default GradingResultsListing;