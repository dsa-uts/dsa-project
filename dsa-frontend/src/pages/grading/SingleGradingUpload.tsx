import React, { useState } from "react";
import { useNavigate } from "react-router";
import { addAuthorizationHeader, useAuthQuery } from "../../auth/hooks";
import { axiosClient, type SuccessResponse } from "../../api/axiosClient";
import { formatTimestamp } from "../../util/timestamp";
import SubmitFormSection from "../../components/SubmitFormSection";
import SearchableCombobox from "../../components/SearchableCombobox";
import { FileArchive, FileText } from "lucide-react";

interface RequiredFiles {
  lecture_id: number;
  title: string;
  files: string[];
}

interface UserInfo {
  id: string;
  name: string;
}

interface RequiredFilesResponse {
  list: RequiredFiles[];
}

const SingleGradingUpload: React.FC = () => {
  const [selectedLecture, setSelectedLecture] = useState<RequiredFiles | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [submissionTs, setSubmissionTs] = useState<number>(Math.floor(Date.now() / 1000));
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string>("");

  const navigate = useNavigate();

  const { isPending: isPendingRequiredFiles, data: requiredFilesData, error: isErrorRequiredFiles } = useAuthQuery<RequiredFilesResponse>({
    queryKey: ['requiredFiles'],
    endpoint: '/problem/fetch/requiredfiles',
    options: {
      queryOptions: {
        retry: 2,
      }
    }
  });

  const { isPending: isPendingUserList, data: userListData, error: isErrorUserList } = useAuthQuery<UserInfo[]>({
    queryKey: ['userList'],
    endpoint: '/user/grading/list',
    options: {
      queryOptions: {
        retry: 2,
      }
    }
  });

  if (isPendingRequiredFiles || isPendingUserList) {
    return <div className="container mx-auto px-8 py-6">
      <div className="text-gray-500 text-center">Loading...</div>
    </div>;
  }

  if (isErrorRequiredFiles || isErrorUserList) {
    return <div className="container mx-auto px-8 py-6">
      <div className="text-red-500 text-center">Error loading data. Please try again later.</div>
    </div>;
  }

  if (!requiredFilesData || !userListData) {
    return <div className="container mx-auto px-8 py-6">
      <div className="text-red-500 text-center">No data available.</div>
    </div>;
  }

  const requiredFiles = requiredFilesData.list;

  const handleLectureSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lectureId = parseInt(e.target.value);
    const lecture = requiredFiles.find(l => l.lecture_id === lectureId);
    setSelectedLecture(lecture || null);
  };


  const handleTimestampChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ts = Math.floor(Date.parse(e.target.value) / 1000);
    if (!isNaN(ts)) {
      setSubmissionTs(ts);
    }
  }

  const handleSubmit = async (files: File[]) => {
    console.log("Submitting files for grading:", { selectedLecture, selectedUser, files });
    setIsSubmitting(true);
    setErrorMessage("");

    if (!selectedLecture || !selectedUser) {
      setErrorMessage("Please select both a lecture and a user.");
      return;
    }

    if (files.length === 0) {
      setErrorMessage("Please select at least one file to upload.");
      return;
    }

    if (files.length > 1) {
      setErrorMessage("Please upload only one zip file.");
      return;
    }

    if (files[0].type !== "application/zip" && !files[0].name.endsWith(".zip")) {
      setErrorMessage("Only zip files are allowed.");
      return;
    }

    const file = files[0];

    const formData = new FormData();
    formData.append("userid", selectedUser.id);
    formData.append("ts", submissionTs.toString());
    formData.append("zipfile", file);

    try {
      const config = addAuthorizationHeader({});
      const response = await axiosClient.post<SuccessResponse>(
        `/problem/judge/batch/${selectedLecture.lecture_id}`,
        formData,
        config
      );

      if (response.data.message) {
        navigate(`/grading/detail/${selectedLecture.lecture_id}/${selectedUser.id}`);
      } else {
        setErrorMessage("Upload failed: No success message received.");
      }
    } catch (error) {
      console.error("Upload failed: ", error);
      setErrorMessage("Upload failed. Please try again.");
    }

    setIsSubmitting(false);
  }

  const isValidFile = (file: File): { valid: boolean; errorMessage: string } => {
    if (file.type === "application/zip" || file.name.endsWith(".zip")) {
      return { valid: true, errorMessage: "" };
    }
    return { valid: false, errorMessage: "Invalid file type. Only zip files are allowed." };
  }

  // Tree item component for file structure visualization
  const TreeItem: React.FC<{ name: string; isLast?: boolean; depth?: number }> = ({
    name,
    isLast = false,
    depth = 0
  }) => {
    return (
      <div className="flex items-center text-sm leading-none">
        <div className="flex items-center">
          {depth > 0 && (
            <span className="text-gray-400 ml-4 mr-2">
              {isLast ? '└──' : '├──'}
            </span>
          )}
          {depth === 0 ? (
            <FileArchive className="w-4 h-4 text-yellow-500 mr-2" />
          ) : (
            <FileText className="w-4 h-4 text-gray-500 mr-2" />
          )}
          <span className={depth === 0 ? 'font-medium text-gray-900' : 'text-gray-700'}>
            {name}
          </span>
        </div>
      </div>
    )
  };

  return (
    <div className="container mx-auto px-8 py-6">
      <h1 className="text-3xl font-semibold mb-6">Grading Request (個別提出)</h1>

      {/* Dropdown selection (lecture) */}
      <div className="mb-8">
        <div className="mb-2 font-semibold text-xl">
          1. Select Lecture (採点対象の課題)
        </div>
        <select
          onChange={handleLectureSelect}
          className="w-full bg-white px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          defaultValue=""
        >
          <option value="" disabled>
            Select Lecture
          </option>
          {requiredFiles.map((lecture) => (
            <option key={lecture.lecture_id} value={lecture.lecture_id}>
              {lecture.lecture_id}. {lecture.title}
            </option>
          ))}
        </select>
      </div>

      {/* User search combobox */}
      <div className="mb-8">
        <div className="mb-2 font-semibold text-xl">
          2. Select User (採点対象ユーザ)
        </div>
        <SearchableCombobox
          items={userListData}
          selected={selectedUser}
          onSelect={setSelectedUser}
          getKey={(u) => u.id}
          getLabel={(u) => `${u.id} - ${u.name}`}
          placeholder="Search by ID or name..."
        />
      </div>

      {/* Timestamp input */}
      <div className="mb-8">
        <div className="mb-2 font-semibold text-xl">
          3. Submission Timestamp (提出日時)
        </div>
        <input
          type="datetime-local"
          onChange={handleTimestampChange}
          className="w-full bg-white px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          defaultValue={formatTimestamp(submissionTs)}
        />
      </div>

      {/* File Structure Display */}
      {selectedLecture && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Expected File Structure</h3>
          <div className="font-mono text-sm">
            <TreeItem name={`class${selectedLecture.lecture_id}.zip`} />
            {selectedLecture.files.map((file, index) => (
              <TreeItem
                key={file}
                name={file}
                isLast={index === selectedLecture.files.length - 1}
                depth={1}
              />
            ))}
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="mb-4 text-red-600">
          {errorMessage}
        </div>
      )}

      {/* File input */}
      <SubmitFormSection
        onSubmit={handleSubmit}
        maxFiles={1}
        isValidFile={isValidFile}
        isLoading={isSubmitting}
      />

    </div>
  )
}

export default SingleGradingUpload
