import React, { useCallback, useState } from "react";
import * as XLSX from 'xlsx';
import { addAuthorizationHeader } from "../../auth/hooks";
import { axiosClient } from "../../api/axiosClient";
import { AlertCircle, Download, FileSpreadsheet, Upload, X } from "lucide-react";

interface UserInfo {
  user_id: string;
  name: string;
  email: string | null;
  password: string;
  role: 'student' | 'manager';
}

interface UploadStatus {
  total: number;
  completed: number;
  failed: number;
  errors: Array<{ user_id: string; error: string }>;
}

const BatchedUserCreation: React.FC = () => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Generate secure password similar to Apple's random password generator
  const generatePassword = (): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segments = [];

    for (let i = 0; i < 3; i++) {
      let segment = '';

      segment += chars.charAt(Math.floor(Math.random() * 26)); // Ensure at least one lowercase
      segment += chars.charAt(Math.floor(Math.random() * 26) + 26); // Ensure at least one uppercase
      segment += chars.charAt(Math.floor(Math.random() * 10) + 52); // Ensure at least one digit
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
      segment += chars.charAt(Math.floor(Math.random() * chars.length));

      // Shuffle segment characters
      segment = segment.split('').sort(() => Math.random() - 0.5).join('');
      segments.push(segment);
    }

    return segments.join('-');
  };

  // Parse Excel file
  const parseExcel = (buffer: ArrayBuffer): UserInfo[] => {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet) as any[];

    return data.map(row => ({
      user_id: String(row.user_id || ''),
      name: String(row.name || ''),
      email: String(row.email || ''),
      role: (row.role === 'manager' ? 'manager' : 'student') as 'student' | 'manager',
      password: String(row.password || generatePassword()),
    }));
  };

  // Parse CSV file
  const parseCSV = (text: string): UserInfo[] => {
    const workbook = XLSX.read(text, { type: 'string' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(firstSheet) as any[];

    return data.map(row => ({
      user_id: String(row.user_id || ''),
      name: String(row.name || ''),
      email: String(row.email || ''),
      role: (row.role === 'manager' ? 'manager' : 'student') as 'student' | 'manager',
      password: String(row.password || generatePassword()),
    }));
  };

  // Handle file upload
  const handleFile = async (file: File) => {
    setFileError(null);

    try {
      let parsedUsers: UserInfo[] = [];

      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        parsedUsers = parseExcel(buffer);
      } else if (file.name.endsWith('.csv')) {
        const text = await file.text();
        parsedUsers = parseCSV(text);
      } else {
        setFileError('Please upload an Excel (.xlsx, .xls) or CSV (.csv) file.');
        return;
      }

      setUsers(parsedUsers);
    } catch (error) {
      setFileError('Error parsing file. Please check the format.');
      console.error('File parsing error:', error);
    }
  };

  // Handle drag and drop
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  // Register users via API
  const registerUsers = async () => {
    setIsProcessing(true);
    const status: UploadStatus = {
      total: users.length,
      completed: 0,
      failed: 0,
      errors: [],
    };
    setUploadStatus(status);

    for (const user of users) {
      try {
        const config = addAuthorizationHeader({});
        await axiosClient.post('/admin/register', user, config);

        status.completed += 1;
      } catch (error: any) {
        status.failed++;
        status.errors.push({
          user_id: user.user_id,
          error: error.response?.data?.message || error.message || 'Registration failed'
        });
      }

      setUploadStatus({ ...status });
    }

    setIsProcessing(false);

    // Auto-download results if successfull
    if (status.completed > 0) {
      downloadResults();
    }
  }

  // Download results as CSV
  const downloadResults = () => {
    const workSheet = XLSX.utils.json_to_sheet(users);

    const fileName = `user_registration_results_${new Date().toISOString().slice(0, 10)}.csv`;

    const csv = XLSX.utils.sheet_to_csv(workSheet);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const clearData = () => {
    setUsers([]);
    setUploadStatus(null);
    setFileError(null);
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <h1 className="text-3xl font-bold mb-2">User Creation (Batch)</h1>

      {/* Instructions */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Example: userList.xlsx or userList.csv</h2>

        {/* Example */}
        <div className="overflow-x-auto mb-6">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-4">user_id</th>
                <th className="text-left py-2 px-4">name</th>
                <th className="text-left py-2 px-4">password</th>
                <th className="text-left py-2 px-4">email</th>
                <th className="text-left py-2 px-4">role</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-2 px-4">202201234</td>
                <td className="py-2 px-4">john doe</td>
                <td className="py-2 px-4">password123</td>
                <td className="py-2 px-4">john.doe@example.com</td>
                <td className="py-2 px-4">student</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 px-4">202201235</td>
                <td className="py-2 px-4">jane smith</td>
                <td className="py-2 px-4">(empty)</td>
                <td className="py-2 px-4">jane.smith@example.com</td>
                <td className="py-2 px-4">manager</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Explanation */}
        <div className="space-y-2 text-sm">
          <p><span className="font-semibold">user_id:</span> 学籍番号あるいは任意の文字列 ("admin"以外)</p>
          <p><span className="font-semibold">name:</span> 任意の名前</p>
          <p><span className="font-semibold">password:</span> 任意のパスワード。10文字以上。空欄の場合は自動生成される。</p>
          <p><span className="font-semibold">email:</span> 任意のメールアドレス (空欄可、これまで使ったことない)</p>
          <p><span className="font-semibold">role:</span> "student" or "manager"</p>
          <div className="ml-4 space-y-1">
            <p>student: Validation Request および 自身のリクエスト結果の取得が可能</p>
            <p>manager: Grading Request, 課題情報の更新</p>
          </div>
        </div>
      </div>

      {/* File Upload Area */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Submit file</label>
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${dragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
              }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-sm font-medium mb-2">Click to upload or drag and drop</p>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => e.target.files && handleFile(e.target.files[0])}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="mt-4 inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Choose File
            </label>
          </div>

          {fileError && (
            <div className="mt-2 text-sm text-red-600 flex items-center">
              <AlertCircle className="h-4 w-4 mr-1" />
              {fileError}
            </div>
          )}
        </div>

        {/* User Preview Table */}
        {users.length > 0 && (
          <div className="mt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">{users.length} users to register</h3>
              <button
                onClick={clearData}
                className="text-sm text-red-600 hover:text-red-700 flex items-center"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </button>
            </div>

            <div className="overflow-x-auto max-h-64 overflow-y-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-4">user_id</th>
                    <th className="text-left py-2 px-4">name</th>
                    <th className="text-left py-2 px-4">email</th>
                    <th className="text-left py-2 px-4">role</th>
                    <th className="text-left py-2 px-4">password</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user, index) => (
                    <tr key={index} className="border-t">
                      <td className="py-2 px-4">{user.user_id}</td>
                      <td className="py-2 px-4">{user.name}</td>
                      <td className="py-2 px-4">{user.email}</td>
                      <td className="py-2 px-4">{user.role}</td>
                      <td className="py-2 px-4 font-mono text-xs">{user.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={registerUsers}
              disabled={isProcessing}
              className="mt-4 w-full bg-blue-500 text-white py-3 px-4 rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isProcessing ? 'Processing...' : 'Register'}
            </button>
          </div>
        )}
      </div>

      {/* Upload Status */}
      {uploadStatus && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-medium mb-4">Registration Status</h3>

          <div className="space-y-2 mb-4">
            <div className="flex justify-between">
              <span>Total:</span>
              <span className="font-semibold">{uploadStatus.total}</span>
            </div>
            <div className="flex justify-between text-green-600">
              <span>Completed:</span>
              <span className="font-semibold">{uploadStatus.completed}</span>
            </div>
            {uploadStatus.failed > 0 && (
              <div className="flex justify-between text-red-600">
                <span>Failed:</span>
                <span className="font-semibold">{uploadStatus.failed}</span>
              </div>
            )}
          </div>

          {uploadStatus.errors.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-2 text-red-600">Errors:</h4>
              <div className="space-y-1 text-sm">
                {uploadStatus.errors.map((error, idx) => (
                  <div key={idx} className="text-red-600">
                    {error.user_id}: {error.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          {uploadStatus.completed > 0 && !isProcessing && (
            <button
              onClick={downloadResults}
              className="mt-4 w-full bg-green-500 text-white py-2 px-4 rounded-md hover:bg-green-600 flex items-center justify-center"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Results with Passwords
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default BatchedUserCreation;