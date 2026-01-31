import { useState } from "react";
import { useAuthQuery } from "../auth/hooks";
import { Link } from "react-router";

interface Problem {
  lecture_id: number;
  problem_id: number;
  registered_at: number;
  title: string;
}

interface Lecture {
  lecture_id: number;
  title: string;
  start_date: number;
  deadline: number;
  problems: Problem[];
}

// url: /dashboard
const DashBoardPage: React.FC = () => {
  const [selectedLecture, setSelectedLecture] = useState<number | null>(null);

  const lectureDataQuery = useAuthQuery<Lecture[]>({
    queryKey: ['lectures'],
    endpoint: '/problem/fetch/list',
    options: {
      queryOptions: {
        retry: 2,
      }
    }
  });

  const isPending = lectureDataQuery.isPending;
  const lectureData = lectureDataQuery.data;
  const error = lectureDataQuery.error;

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">Error loading lectures: {error.message}</div>
      </div>
    );
  }

  if (!lectureData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">No lectures available</div>
      </div>
    );
  }

  // Filter lectures based on selection
  const displayedLectures = selectedLecture === null
    ? lectureData
    : lectureData.filter(lecture => lecture.lecture_id === selectedLecture);

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Title */}
      <h1 className="text-2xl font-bold mb-6">Problem List</h1>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-8 border-b border-gray-300 overflow-x-auto">
        <button
          key="all-button"
          onClick={() => setSelectedLecture(null)}
          className={`px-4 py-2 whitespace-nowrap  transition-colors ${selectedLecture === null
            ? 'border-b-2 border-blue-500 text-blue-600 font-medium'
            : 'text-gray-600 hover:text-gray-800'
            }`}
        >
          All
        </button>
        {lectureData.map((lecture) => (
          <button
            key={`top-lecture-${lecture.lecture_id}`}
            onClick={() => setSelectedLecture(lecture.lecture_id)}
            className={`px-4 py-2 whitespace-nowrap transition-colors ${selectedLecture === lecture.lecture_id
              ? 'border-b-2 border-blue-500 text-blue-600 font-medium'
              : 'text-gray-600 hover:text-gray-800'
              }`}
          >
            {lecture.title}
          </button>
        ))}
      </div>

      {/* Lecture List */}
      <div className="space-y-6">
        {displayedLectures.map((lecture) => (
          <div key={`lecture-${lecture.lecture_id}`} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center space-x-4 px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold">{lecture.title}</h2>
              {/* link to /validation/batch?lectureid=... */}
              <Link to={`/validation/batch?lectureid=${lecture.lecture_id}`} className="text-blue-500 font-semibold hover:text-blue-700 underline text-sm">
                [最終確認]
              </Link>
            </div>
            <div className="p-6">
              {lecture.problems.length > 0 ? (
                <div className="space-y-3">
                  {lecture.problems.map((problem) => (
                    <Link
                      key={`problem-${problem.lecture_id}-${problem.problem_id}`}
                      to={`/problem/${problem.lecture_id}/${problem.problem_id}`}
                      className="block p-4 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                    >
                      <span className="text-gray-700">{problem.title}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-gray-400 text-center py-8">
                  No problems available
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default DashBoardPage;