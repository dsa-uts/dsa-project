import type React from "react";
import { useEffect, useState } from "react";
import SubmitFormSection from "../components/SubmitFormSection";
import { FileArchive, FileText } from "lucide-react";
import { useAuthMutation, useAuthQuery } from "../auth/hooks";
import { useNavigate, useSearchParams } from "react-router";

interface RequiredFiles {
  lecture_id: number;
  title: string;
  files: string[];
}

interface APIResponse {
  list: RequiredFiles[];
}

// url: /validation/batch?lectureid=...
const BatchValidation: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedLecture, setSelectedLecture] = useState<RequiredFiles | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const navigate = useNavigate();

  const { isPending, data: requiredFilesData, error } = useAuthQuery<APIResponse>({
    queryKey: ['requiredFiles'],
    endpoint: '/problem/fetch/requiredfiles',
    options: {
      queryOptions: {
        retry: 2,
      }
    }
  });

  const submitMutation = useAuthMutation<any, FormData>({
    endpoint: selectedLecture ? `/problem/validate/batch/${selectedLecture.lecture_id}` : '/problem/validate/batch/undefined',
    options: {
      method: 'POST',
      axiosConfig: {
        headers: {
          'Content-Type': 'multipart/form-data',
        }
      },
      mutationOptions: {
        onSuccess: (data) => {
          console.log("Submission successful:", data);
        },
        onError: (error) => {
          console.error("Submission error:", error);
        },
      }
    },
  })

  useEffect(() => {
    if (!requiredFilesData) return;

    const lectureIdFromParam = searchParams.get('lectureid');
    const lectureIdNumFromParam = lectureIdFromParam ? parseInt(lectureIdFromParam) : null;

    if (!lectureIdNumFromParam) {
      setSelectedLecture(null);
      setSearchParams({});
      return;
    }

    const lecture = requiredFilesData.list.find(l => l.lecture_id === lectureIdNumFromParam);
    if (!lecture) {
      setSelectedLecture(null);
      setSearchParams({});
      return;
    }

    if (lecture && selectedLecture === null) {
      setSelectedLecture(lecture);
      return;
    }

    if (lecture && selectedLecture && selectedLecture.lecture_id !== lecture.lecture_id) {
      setSelectedLecture(lecture);
      return;
    }
  }, [requiredFilesData]);

  if (isPending) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-gray-500 text-center">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-red-500 text-center">Error loading required files: {error.message}</div>
      </div>
    )
  }

  if (!requiredFilesData) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-gray-500 text-center">No required files data available</div>
      </div>
    )
  }

  const handleLectureChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lectureId = parseInt(e.target.value);
    const lecture = requiredFilesData.list.find(l => l.lecture_id === lectureId);
    setSelectedLecture(lecture || null);
    setSearchParams(lecture ? { lectureid: lecture.lecture_id.toString() } : {});
  };

  const handleSubmit = async (files: File[]) => {
    console.log("Submitting files for lecture:", selectedLecture?.lecture_id, files);

    if (!selectedLecture) return;
    if (files.length === 0) return;
    if (files.length > 1) {
      alert("Please upload only one zip file.");
      return;
    }
    if (files[0].type !== "application/zip" && !files[0].name.endsWith(".zip")) {
      alert("Please upload a valid zip file.");
      return;
    }

    const file = files[0];

    const formData = new FormData();
    formData.append("zipfile", file);

    try {
      const result = await submitMutation.mutateAsync(formData);
      console.log("Submission successful: ", result);

      navigate('/validation/results');
    } catch (err) {
      console.error("Submission failed: ", err);
      setErrorMessage("Submission failed. Please try again.");
    }
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
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Validation Request</h1>

      {/* Dropdown selection */}
      <div className="mb-6">
        <select
          onChange={handleLectureChange}
          className="w-full bg-white px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          defaultValue=""
        >
          <option value="" disabled>
            Select
          </option>
          {requiredFilesData.list.map((lecture) => (
            <option key={lecture.lecture_id} value={lecture.lecture_id}>
              {lecture.lecture_id}. {lecture.title}
            </option>
          ))}
        </select>
      </div>

      {/* File Structure Display */}
      {selectedLecture && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Expected File Structure</h3>
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

      {/* Submit Form Section */}
      {selectedLecture && (
        <SubmitFormSection
          onSubmit={handleSubmit}
          maxFiles={1}
          isValidFile={(file: File) => {
            // Only allow zip files
            const valid_types = ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'];
            const isZip = valid_types.includes(file.type) || file.name.endsWith(".zip");
            return {
              valid: isZip,
              errorMessage: isZip ? "" : "Only zip files are allowed."
            };
          }}
        />
      )}
    </div>
  )
}

export default BatchValidation;
