import React, { useState } from "react";
import { addAuthorizationHeader, useAuthQuery } from "../../auth/hooks";
import { axiosClient, type SuccessResponse } from "../../api/axiosClient";
import { Check, ChevronDown, ChevronUp, Plus, Trash2, Upload, X } from "lucide-react";
import { formatTimestamp } from "../../util/timestamp";

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

interface LectureEntryProps {
  id: number;
  title: string;
  start_date: number;
  deadline: number;
}

const ProblemRegistration: React.FC = () => {
  const [expandedLectures, setExpandedLectures] = useState<Set<number>>(new Set());
  const [editingLecture, setEditingLecture] = useState<number | null>(null);
  const [editFormData, setEditFormData] = useState<LectureEntryProps | null>(null);

  const [addingProblemToLecture, setAddingProblemToLecture] = useState<number | null>(null);
  const [newProblemData, setNewProblemData] = useState<{ problemId: string; file: File | null }>({
    problemId: '',
    file: null,
  });

  const [isAddingLecture, setIsAddingLecture] = useState<boolean>(false);
  const [newLectureData, setNewLectureData] = useState<{ id: string; title: string; start_date: number; deadline: number }>({
    id: '',
    title: '',
    start_date: Math.floor(Date.now() / 1000),
    deadline: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });

  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());

  const lectureDataQuery = useAuthQuery<Lecture[]>({
    queryKey: ['lectures', lastFetchTime.toString()],
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

  const toggleLectureExpansion = (lectureId: number) => {
    const newExpanded = new Set(expandedLectures);
    if (newExpanded.has(lectureId)) {
      newExpanded.delete(lectureId);
    } else {
      newExpanded.add(lectureId);
    }
    setExpandedLectures(newExpanded);
  };

  const handleEditSave = async () => {
    if (!editFormData) return;

    // Call handleUpdateLectureEntry to save changes
    const success = await handleUpdateLectureEntry(editFormData);
    if (success) {
      setEditingLecture(null);
      setEditFormData(null);
    } else {
      alert("Failed to update lecture entry. Please try again.");
    }
  }

  const handleDeleteLecture = async (lectureId: number) => {
    if (!confirm("Are you sure you want to delete this lecture? This action cannot be undone.")) {
      return;
    }

    const success = await handleDeleteLectureEntry(lectureId);
    if (!success) {
      alert("Failed to delete lecture entry. Please try again.");
    }
  }

  const handleDeleteProblem = async (lectureId: number, problemId: number) => {
    if (!confirm("Are you sure you want to delete this problem from the lecture? This action cannot be undone.")) {
      return;
    }

    const success = await handleDeleteProblemEntry(lectureId, problemId);
    if (!success) {
      alert("Failed to delete problem entry. Please try again.");
    }
  }

  const handleAddProblem = async (lectureId: number) => {
    if (!newProblemData.file || !newProblemData.problemId) {
      alert("Please select a ZIP file to upload.");
      return;
    }

    const problemId = parseInt(newProblemData.problemId);
    if (isNaN(problemId) || problemId <= 0) {
      alert("Please enter a valid Problem ID.");
      return;
    }

    // Check if problemId already exists in the lecture
    const lecture = lectureData?.find(l => l.lecture_id === lectureId);
    if (lecture?.problems.some(p => p.problem_id === problemId)) {
      alert("A problem with this Problem ID already exists in the lecture.");
      return;
    }

    const success = await handleAddProblemEntry(lectureId, problemId, newProblemData.file);

    if (success) {
      setAddingProblemToLecture(null);
      setNewProblemData({ problemId: '', file: null });
    }
    else {
      alert("Failed to add problem entry. Please try again.");
    }
  }

  const handleAddLecture = async () => {
    if (!newLectureData.id || !newLectureData.title) {
      alert("Please fill in all fields for the new lecture.");
      return;
    }

    const lectureId = parseInt(newLectureData.id);
    if (isNaN(lectureId) || lectureId <= 0) {
      alert("Please enter a valid Lecture ID.");
      return;
    }

    // Check if lectureId already exists
    if (lectureData?.some(l => l.lecture_id === lectureId)) {
      alert("A lecture with this Lecture ID already exists.");
      return;
    }

    if (newLectureData.start_date >= newLectureData.deadline) {
      alert("Start date must be before the deadline.");
      return;
    }

    const success = await handleAddLectureEntry({
      id: lectureId,
      title: newLectureData.title,
      start_date: newLectureData.start_date,
      deadline: newLectureData.deadline,
    });

    if (success) {
      setIsAddingLecture(false);
      setNewLectureData({ id: '', title: '', start_date: Math.floor(Date.now() / 1000), deadline: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 });
    } else {
      alert("Failed to add lecture entry. Please try again.");
    }
  }

  const handleUpdateLectureEntry = async (entry: LectureEntryProps) => {
    try {
      const config = addAuthorizationHeader({});
      const result = await axiosClient.patch<SuccessResponse>(
        `/problem/crud/update/${entry.id}`,
        entry,
        config,
      );

      if (result.data.message) {
        console.log("Lecture entry updated successfully:", result.data.message);

        setLastFetchTime(Date.now());
        // lectureData will be refetched due to lastFetchTime change
        return true;
      }
    } catch (error) {
      console.error("Error updating lecture entry:", error);
      alert("Failed to update lecture entry. Please try again.");
      return false;
    }
    return false;
  }

  const handleDeleteLectureEntry = async (id: number) => {
    try {
      const config = addAuthorizationHeader({});
      const result = await axiosClient.delete<SuccessResponse>(
        `/problem/crud/delete/${id}`,
        config,
      );

      if (result.data.message) {
        console.log("Lecture entry deleted successfully:", result.data.message);

        setLastFetchTime(Date.now());
        // lectureData will be refetched due to lastFetchTime change
        return true;
      }
    } catch (error) {
      console.error("Error deleting lecture entry:", error);
      alert("Failed to delete lecture entry. Please try again.");
      return false;
    }

    return false;
  }

  const handleDeleteProblemEntry = async (lectureId: number, problemId: number) => {
    try {
      const config = addAuthorizationHeader({});
      const result = await axiosClient.delete<SuccessResponse>(
        `/problem/crud/delete/${lectureId}/${problemId}`,
        config,
      );

      if (result.data.message) {
        console.log("Problem entry deleted successfully:", result.data.message);

        setLastFetchTime(Date.now());
        // lectureData will be refetched due to lastFetchTime change
        return true;
      }
    } catch (error) {
      console.error("Error deleting problem entry:", error);
      alert("Failed to delete problem entry. Please try again.");
      return false;
    }
  }

  const handleAddProblemEntry = async (lectureId: number, problemId: number, zipFile: File) => {
    try {
      const formData = new FormData();
      formData.append("file", zipFile);

      const config = addAuthorizationHeader({
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = await axiosClient.post<SuccessResponse>(
        `/problem/crud/create/${lectureId}/${problemId}`,
        formData,
        config,
      );

      if (result.data.message) {
        console.log("Problem entry added successfully:", result.data.message);

        setLastFetchTime(Date.now());
        // lectureData will be refetched due to lastFetchTime change
        return true;
      }
    } catch (error) {
      console.error("Error adding problem entry:", error);
      alert("Failed to add problem entry. Please try again.");
      return false;
    }
  }

  const handleAddLectureEntry = async (entry: LectureEntryProps) => {
    try {
      const config = addAuthorizationHeader({});
      const result = await axiosClient.put<SuccessResponse>(
        `/problem/crud/create`,
        entry,
        config,
      );

      if (result.data.message) {
        console.log("Lecture entry added successfully:", result.data.message);

        setLastFetchTime(Date.now());
        // lectureData will be refetched due to lastFetchTime change
        return true;
      }
    } catch (error) {
      console.error("Error adding lecture entry:", error);
      alert("Failed to add lecture entry. Please try again.");
      return false;
    }
  }

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">Error loading lectures: {error.message}</div>
      </div>
    );
  }

  const renderProblemRows = (lectureId: number, problems: Problem[]) => {
    return (
      <table className="w-full">
        <thead className="bg-white border-b border-gray-200">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
              Problem ID
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
              Title
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {problems.map((problem) => (
            <tr key={problem.problem_id}>
              <td className="px-4 py-2 text-sm">{problem.problem_id}</td>
              <td className="px-4 py-2 text-sm">{problem.title}</td>
              <td className="px-4 py-2 text-sm text-right">
                <button
                  onClick={() => handleDeleteProblem(problem.lecture_id, problem.problem_id)}
                  className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition-colors flex items-center gap-1 ml-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {addingProblemToLecture === lectureId ? (
            <tr>
              <td className="px-4 py-2 text-sm">
                <input
                  type="text"
                  placeholder="ID"
                  value={newProblemData.problemId}
                  onChange={(e) => setNewProblemData(prev => ({ ...prev, problemId: e.target.value }))}
                  className="border border-gray-300 rounded px-2 py-1 w-20"
                />
              </td>
              <td className="px-4 py-2 text-sm">
                <label className="mt-2 flex items-center cursor-pointer">
                  <input
                    type="file"
                    accept=".zip"
                    onChange={(e) => setNewProblemData(prev => ({ ...prev, file: e.target.files?.[0] || null }))}
                    className="hidden"
                  />
                  <span className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300 transition-colors flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    {newProblemData.file ? newProblemData.file.name : "Choose ZIP file"}
                  </span>
                </label>
              </td>
              <td className="px-4 py-2 text-sm text-right">
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => handleAddProblem(lectureId)}
                    className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 transition-colors flex items-center gap-1"
                  >
                    <Check className="w-4 h-4" />
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setAddingProblemToLecture(null);
                      setNewProblemData({ problemId: '', file: null });
                    }}
                    className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600 transition-colors flex items-center gap-1"
                  >
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              </td>
            </tr>
          ) : (
            <tr>
              <td colSpan={3} className="px-4 py-2">
                <button
                  onClick={() => setAddingProblemToLecture(lectureId)}
                  className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    )
  }

  return (
    <div className="container mx-auto px-8 py-6">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold">Problem Registration</h1>
      </div>

      {/* Main contents */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Lecture ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Title
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Start Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Deadline
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {lectureData && lectureData.map((lecture) => (
              <React.Fragment key={lecture.lecture_id}>
                <tr
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('.actions-cell')) {
                      toggleLectureExpansion(lecture.lecture_id);
                    }
                  }}
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex items-center">
                      {expandedLectures.has(lecture.lecture_id) ? (
                        <ChevronUp className="w-4 h-4 mr-2" />
                      ) : (
                        <ChevronDown className="w-4 h-4 mr-2" />
                      )}
                      {lecture.lecture_id}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {editingLecture === lecture.lecture_id ? (
                      <input
                        type="text"
                        value={editFormData?.title}
                        onChange={(e) => setEditFormData(prev => prev ? { ...prev, title: e.target.value } : null)}
                        className="border border-gray-300 rounded px-2 py-1 w-full"
                      />
                    ) : (
                      lecture.title
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {editingLecture === lecture.lecture_id ? (
                      <input
                        type="datetime-local"
                        value={formatTimestamp(editFormData?.start_date || 0)}
                        onChange={(e) => setEditFormData(prev => prev ? { ...prev, start_date: Math.floor(Date.parse(e.target.value) / 1000) } : null)}
                        className="border border-gray-300 rounded px-2 py-1"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      formatTimestamp(lecture.start_date)
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {editingLecture === lecture.lecture_id ? (
                      <input
                        type="datetime-local"
                        value={formatTimestamp(editFormData?.deadline || 0)}
                        onChange={(e) => setEditFormData(prev => prev ? { ...prev, deadline: Math.floor(Date.parse(e.target.value) / 1000) } : null)}
                        className="border border-gray-300 rounded px-2 py-1"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      formatTimestamp(lecture.deadline)
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right actions-cell">
                    <div className="flex justify-end gap-2">
                      {editingLecture === lecture.lecture_id ? (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditSave();
                            }}
                            className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 transition-colors flex items-center gap-1"
                          >
                            <Check className="w-4 h-4" />
                            Save
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLecture(null);
                              setEditFormData(null);
                            }}
                            className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600 transition-colors flex items-center gap-1"
                          >
                            <X className="w-4 h-4" />
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLecture(lecture.lecture_id);
                            }}
                            className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition-colors flex items-center gap-1"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedLectures.has(lecture.lecture_id) && (
                  <tr>
                    <td colSpan={5} className="px-4 py-2 bg-gray-50">
                      <div className="ml-8">
                        {renderProblemRows(lecture.lecture_id, lecture.problems)}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {isAddingLecture ? (
              <tr>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <input
                    type="text"
                    placeholder="ID"
                    value={newLectureData.id}
                    onChange={(e) => setNewLectureData(prev => ({ ...prev, id: e.target.value }))}
                    className="border border-gray-300 rounded px-2 py-1 w-20"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <input
                    type="text"
                    placeholder="Title"
                    value={newLectureData.title}
                    onChange={(e) => setNewLectureData(prev => ({ ...prev, title: e.target.value }))}
                    className="border border-gray-300 rounded px-2 py-1 w-full"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <input
                    type="datetime-local"
                    value={formatTimestamp(newLectureData.start_date)}
                    onChange={(e) => setNewLectureData(prev => ({ ...prev, start_date: Math.floor(Date.parse(e.target.value) / 1000) }))}
                    className="border border-gray-300 rounded px-2 py-1"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <input
                    type="datetime-local"
                    value={formatTimestamp(newLectureData.deadline)}
                    onChange={(e) => setNewLectureData(prev => ({ ...prev, deadline: Math.floor(Date.parse(e.target.value) / 1000) }))}
                    className="border border-gray-300 rounded px-2 py-1"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleAddLecture()}
                      className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 transition-colors flex items-center gap-1"
                    >
                      <Check className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setIsAddingLecture(false);
                        setNewLectureData({ id: '', title: '', start_date: Math.floor(Date.now() / 1000), deadline: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 });
                      }}
                      className="bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600 transition-colors flex items-center gap-1"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-4">
                  <button
                    onClick={() => setIsAddingLecture(true)}
                    className="w-full bg-blue-500 text-white py-3 rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 font-medium"
                  >
                    <Plus className="w-6 h-6" />
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ProblemRegistration;
