import React, { useCallback, useState } from "react";
import { axiosClient, type SuccessResponse } from "../../api/axiosClient";
import { addAuthorizationHeader, useAuthQuery } from "../../auth/hooks";
import * as XLSX from 'xlsx';
import JSZip from "jszip";
import { AlertCircle, CheckCircle, File as FileIcon, FileArchive, FileText, Folder, Loader2, Upload, X, XCircle } from "lucide-react";
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

interface StudentSubmission {
  userId: string;
  numId: string;
  name: string;
  submissionDate: number | null;
  fileSize: number | null;
  zipFile: File | null;
  status: 'success' | 'error' | 'not_submitted';
  errorMessage?: string;
}

interface SubmissionProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  isSubmitting: boolean;
}

const BatchedGradingUpload: React.FC = () => {
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedLecture, setSelectedLecture] = useState<number | null>(null);

  const [submissionProgress, setSubmissionProgress] = useState<SubmissionProgress>({
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    isSubmitting: false,
  });

  const { isPending, data: lectureData, error: lectureError } = useAuthQuery<Lecture[]>({
    queryKey: ['lectures'],
    endpoint: '/problem/fetch/list',
    options: {
      queryOptions: {
        retry: 2,
      }
    }
  });

  const formatFileSize = (bytes: number | null): string => {
    if (bytes === null) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: number | null): string => {
    if (!dateStr) return '-';
    return new Date(dateStr * 1000).toLocaleString();
  };

  const execlDateToUnixTimestamp = (excelDate: number): number => {
    // ref: https://stackoverflow.com/questions/1703505/excel-date-to-unix-timestamp
    return (excelDate - 25569) * 86400;
  }

  const clearData = () => {
    setSubmissions([]);
    setIsProcessing(false);
    setUploadedFile(null);
    setErrorMessage('');

    setSubmissionProgress({
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      isSubmitting: false,
    });
  }

  const processReportZip = async (file: File) => {
    setIsProcessing(true);
    setErrorMessage('');
    setSubmissions([]);

    try {
      const zip = new JSZip();
      const contents = await zip.loadAsync(file);

      // search reportlist.xlsx
      // "reportlist.xlsx" or ".../reportlist.xlsx"
      const excelFile = Object.values(contents.files).find(f => f.name.endsWith('reportlist.xlsx'));
      if (!excelFile) {
        throw new Error('reportlist.xlsx not found in the zip file.');
      }

      // read excel file
      const excelData = await excelFile.async('arraybuffer');
      const workbook = XLSX.read(excelData, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];

      const studentSubmissions: StudentSubmission[] = [];
      let row = 8; // Start from row 8

      // Read until finds "#end" in column A
      let count = 0;
      while (true) {
        count += 1;
        if (count > 1000) {
          throw new Error('Too many rows in the excel file, possible infinite loop.');
        }
        const cellA = worksheet[`A${row}`];
        if (cellA && cellA.v === '') break;
        if (cellA && cellA.v === '#end') break;

        const userId = worksheet[`E${row}`]?.v?.toString() || '';
        const numId = worksheet[`F${row}`]?.v?.toString() || '';
        const name = worksheet[`G${row}`]?.v?.toString() || '';
        const submissionDateCell = worksheet[`N${row}`];

        if (!userId || !numId || !name) {
          row += 1;
          continue; // skip invalid rows
        }

        let submissionDate: number | null = null;
        if (submissionDateCell && submissionDateCell.v) {
          if (typeof submissionDateCell.v === 'number') {
            submissionDate = execlDateToUnixTimestamp(submissionDateCell.v);
          } else if (typeof submissionDateCell.v === 'string') {
            const parsed = new Date(submissionDateCell.v);
            if (!isNaN(parsed.getTime())) {
              submissionDate = parsed.getTime() / 1000;
            }
          }
        }

        let submission: StudentSubmission = {
          userId,
          numId,
          name,
          submissionDate,
          fileSize: null,
          zipFile: null,
          status: 'not_submitted',
        };

        for (const file of Object.values(contents.files)) {
          console.log(file.name);
        }

        if (submissionDate) {
          const folderName = `${numId}@${userId}/`;
          const filesInFolder = Object.values(contents.files).filter(file =>
            file.name.includes(folderName) && !file.dir
          );

          if (filesInFolder) {
            if (filesInFolder.length === 0) {
              submission.status = 'error';
              submission.errorMessage = 'Empty submission folder.';
            } else if (filesInFolder.length > 1) {
              submission.status = 'error';
              submission.errorMessage = 'Multiple files found in submission folder.';
            } else {
              const filePath = filesInFolder[0].name;
              const fileName = filePath.split('/').pop() || '';

              if (!fileName.endsWith('.zip')) {
                submission.status = 'error';
                submission.errorMessage = 'Submitted file is not a zip file.';
              } else {
                const zipContent = await contents.files[filePath].async('blob');
                const zipFile = new File([zipContent], fileName, { type: 'application/zip' });
                submission.zipFile = zipFile;
                submission.fileSize = zipContent.size;
                submission.status = 'success';

                submission.status = 'success';
                submission.fileSize = zipContent.size;
                submission.zipFile = zipFile;
              }
            }
          } else {
            submission.status = 'error';
            submission.errorMessage = 'Submission folder not found in the zip.';
          }
        }

        studentSubmissions.push(submission);
        row += 1;
      }

      setSubmissions(studentSubmissions);
      setUploadedFile(file);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'An unknown error occurred while processing the zip file.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.match(/^report-.*\.zip$/i)) {
      processReportZip(file);
    } else {
      setErrorMessage('Please upload a valid report-*.zip file.');
    }

    if (event.target) {
      // Reset the input value to allow re-uploading the same file if needed
      event.target.value = '';
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (file && file.name.match(/^report-.*\.zip$/i)) {
      processReportZip(file);
    } else {
      setErrorMessage('Please upload a valid report-*.zip file.');
    }
  }, []);

  const handleSubmit = async () => {
    const validSubmissions = submissions.filter(s => s.status === 'success' && s.zipFile);

    if (!selectedLecture) {
      alert('Please select a lecture.');
      return;
    }

    setSubmissionProgress({
      total: validSubmissions.length,
      processed: 0,
      successful: 0,
      failed: 0,
      isSubmitting: true,
    });

    console.log('Submitting ', validSubmissions.length, ' submissions');

    for (let i = 0; i < validSubmissions.length; i++) {
      const submission = validSubmissions[i];
      console.log(`Student: ${submission.name} (${submission.numId})`);
      console.log(`Unix timestamp: ${submission.submissionDate}`);

      if (!submission.numId || !submission.submissionDate || !submission.zipFile) {
        console.error('Invalid submission data, skipping:', submission);

        setSubmissionProgress(prev => ({
          ...prev,
          processed: prev.processed + 1,
          failed: prev.failed + 1,
        }));
        continue;
      }

      const success = await handleBatchedGrading(
        selectedLecture,
        submission.numId,
        submission.submissionDate,
        submission.zipFile
      );

      setSubmissionProgress(prev => ({
        ...prev,
        processed: prev.processed + 1,
        successful: success ? prev.successful + 1 : prev.successful,
        failed: success ? prev.failed : prev.failed + 1,
      }));

      if (success) {
        submission.status = 'success';
        submission.errorMessage = undefined;
      } else {
        submission.status = 'error';
        submission.errorMessage = 'Failed to submit grading request.';
      }

      // Update state to reflect the change
      setSubmissions(prevSubmissions =>
        prevSubmissions.map(s =>
          s.userId === submission.userId ? { ...s, status: submission.status, errorMessage: submission.errorMessage } : s
        )
      );
    }

    setSubmissionProgress(prev => ({
      ...prev,
      isSubmitting: false,
    }));
  };

  const handleBatchedGrading = async (lectureId: number, userId: string, ts: number, zipFile: File) => {
    let success = true;

    try {
      const formData = new FormData();
      formData.append('userid', userId);
      formData.append('ts', ts.toString());
      formData.append('zipfile', zipFile);

      const config = addAuthorizationHeader({});

      const response = await axiosClient.post<SuccessResponse>(
        `/problem/judge/batch/${lectureId}`,
        formData,
        config
      );

      if (response.status !== 200) {
        console.error('Failed to submit grading request:', response.statusText);
        success = false;
      }

      if (response.data.message) {
        console.log('Server message:', response.data.message);
      }

    } catch (error) {
      console.error('Error creating FormData:', error);
      success = false;
    }
    return success;
  }

  const handleLectureChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lectureId = parseInt(e.target.value);
    setSelectedLecture(lectureId || null);
  };

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (lectureError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">Error loading lectures: {lectureError.message}</div>
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

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-semibold mb-6">Grading Request （一括提出）</h1>

      {/* Dropdown selection */}
      <div className="mb-6">
        <select
          onChange={handleLectureChange}
          className="w-full bg-white px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          defaultValue=""
          disabled={submissionProgress.isSubmitting}
        >
          <option value="" disabled>
            Select Lecture
          </option>
          {lectureData.map((lecture) => (
            <option key={lecture.lecture_id} value={lecture.lecture_id}>
              {lecture.lecture_id}. {lecture.title}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Expected FileStructure:</h3>
        <div className="font-mono text-sm">
          <div className="flex items-center">
            <FileArchive className="w-4 h-4 text-yellow-500 mr-2" />
            <span className="font-medium text-gray-900">report-*.zip</span>
          </div>
          <div className="ml-1">
            <div className="flex items-center">
              ├── <Folder className="w-4 h-4 text-gray-500 ml-2 mr-2" /> <span className="text-gray-700">203020123@0012030201232/</span>
            </div>
            <div className="flex items-center">
              <span className="-ml-1 rotate-90">...</span><span className="ml-4">└──</span><FileArchive className="w-4 h-4 text-yellow-500 ml-2 mr-2" /> <span className="text-gray-700">class1.zip</span>
            </div>
            <div className="flex items-center">
              └── <FileIcon className="w-4 h-4 text-green-500 ml-2" /><span className="text-gray-700 ml-2">reportlist.xlsx</span>
            </div>
          </div>
        </div>
      </div>

      {/* File Upload Area */}
      <div className="mb-8">
        <div
          className={`border-2 border-dashed border-gray-300 rounded-lg p-8 text-center transition-colors ${submissionProgress.isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500 cursor-pointer'
            }`}
          onDragOver={!submissionProgress.isSubmitting ? handleDragOver : undefined}
          onDrop={!submissionProgress.isSubmitting ? handleDrop : undefined}
        >
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".zip"
            onChange={handleFileUpload}
            disabled={isProcessing || submissionProgress.isSubmitting}
          />
          <label htmlFor="file-upload" className={submissionProgress.isSubmitting ? "cursor-not-allowed" : "cursor-pointer"}>
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-lg mb-2">report-*.zip ファイルをドラッグ&ドロップ</p>
            <p className="text-sm text-gray-500">または クリックしてファイルを選択</p>
          </label>
        </div>

        {uploadedFile && (
          <div className="mt-4 flex justify-between items-center text-sm text-gray-600">
            <div className="flex">
              <FileText className="mr-2 h-4 w-4" />
              <span>{uploadedFile.name}</span>
            </div>
            <button
              onClick={clearData}
              className="text-sm text-red-600 hover:text-red-700 flex items-center"
              disabled={submissionProgress.isSubmitting}
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center">
            <AlertCircle className="mr-2 h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-red-700">{errorMessage}</span>
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin h-8 w-8 text-blue-500 mr-3" />
          <span className="text-lg">Processing...</span>
        </div>
      )}

      {/* Submission Progress */}
      {submissionProgress.isSubmitting && (
        <div className="mb-6 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center mb-4">
            <Loader2 className="animate-spin h-5 w-5 text-blue-600 mr-3" />
            <span className="text-lg font-medium text-blue-900">
              Submitting... ({submissionProgress.processed}/{submissionProgress.total})
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${(submissionProgress.processed / submissionProgress.total) * 100}%` }}
            />
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="flex items-center">
              <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
              <span className="text-gray-700">Success: {submissionProgress.successful}</span>
            </div>
            <div className="flex items-center">
              <XCircle className="h-4 w-4 text-red-700 mr-2" />
              <span className="text-gray-700">Failed: {submissionProgress.failed}</span>
            </div>
            <div className="flex items-center">
              <span className="text-gray-700">
                Success: {submissionProgress.processed > 0
                  ? `${Math.round((submissionProgress.successful / submissionProgress.processed) * 100)}%`
                  : '0%'
                }
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Result After Submission */}
      {!submissionProgress.isSubmitting && submissionProgress.total > 0 && submissionProgress.processed === submissionProgress.total && (
        <div className={`mb-6 p-6 border rounded-lg ${submissionProgress.failed === 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'
          }`}>
          <div className="flex items-center mb-2">
            {submissionProgress.failed === 0 ? (
              <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-600 mr-3" />
            )}
            <Link to={`/grading/results?lectureid=${selectedLecture}`} className="hover:underline">
              <span className={`text-lg font-medium ${submissionProgress.failed === 0 ? 'text-green-900' : 'text-yellow-900'
                }`}>
                Submission Complete (Click to view results)
              </span>
            </Link>
          </div>
          <div className="text-sm text-gray-700">
            {submissionProgress.successful} succeeded
            {submissionProgress.failed > 0 && `, ${submissionProgress.failed} failed`}.
            (rate: {Math.round((submissionProgress.successful / submissionProgress.total) * 100)}%)
          </div>
        </div>
      )}

      {submissions.length > 0 && !isProcessing && (
        <>
          {/* Submit Button */}
          <div className="flex justify-center mb-6">
            <button
              onClick={handleSubmit}
              disabled={submissions.filter(s => s.status === 'success' && s.zipFile).length === 0 || submissionProgress.isSubmitting}
              className="px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {submissionProgress.isSubmitting
                ? `Submitting... (${submissionProgress.processed}/${submissionProgress.total})`
                : `Submit (${submissions.filter(s => s.status === 'success' && s.zipFile).length} 件)`
              }
            </button>
          </div>

          {/* Statistics */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-500">Submitted</p>
              <p className="text-2xl font-semibold text-green-600">
                {submissions.filter(s => s.status === 'success').length}
              </p>
            </div>

            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-500">Error</p>
              <p className="text-2xl font-semibold text-red-600">
                {submissions.filter(s => s.status === 'error').length}
              </p>
            </div>

            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-500">Not Submitted</p>
              <p className="text-2xl font-semibold text-gray-600">
                {submissions.filter(s => s.status === 'not_submitted').length}
              </p>
            </div>
          </div>

          <div className="bg-white shadow-lg rounded-lg overflow-hidden mb-6">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Student ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Submission Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {submissions.map((submission, index) => (
                  <tr key={index} className={submission.status === 'error' ? 'bg-red-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {submission.status === 'success' && (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      )}
                      {submission.status === 'error' && (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                      {submission.status === 'not_submitted' && (
                        <AlertCircle className="h-5 w-5 text-gray-400" />
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {submission.numId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {submission.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(submission.submissionDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatFileSize(submission.fileSize)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {submission.errorMessage && (
                        <span className="text-red-600">{submission.errorMessage}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}
    </div>
  )
}

export default BatchedGradingUpload;