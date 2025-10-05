import { useEffect, useState } from "react";
import { addAuthorizationHeader, useAuthQuery } from "../../auth/hooks";
import { AlertCircle, Save, Trash2, X } from "lucide-react";
import { axiosClient, type SuccessResponse } from "../../api/axiosClient";

interface User {
  user_id: string;
  name: string;
  email: string | null;
  role: 'student' | 'manager' | 'admin';
  archived: boolean;
}

interface APIResponse {
  users: User[];
}

interface EditingUser extends User {
  password?: string;
}

const UserList: React.FC = () => {
  const { data: apiResponse, isLoading, error } = useAuthQuery<APIResponse>({
    queryKey: ['userList'],
    endpoint: '/admin/users',
    options: {
      queryOptions: {
        enabled: true,
      }
    }
  });

  const [users, setUsers] = useState<User[]>([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<EditingUser | null>(null);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!apiResponse) return;
    setUsers(apiResponse.users);
  }, [apiResponse]);

  const startEditing = (user: User) => {
    if (user.role === 'admin') return;
    setEditingUserId(user.user_id);
    setEditingData({ ...user, password: '' });
    setErrorMessage(null);
  };

  const cancelEditing = () => {
    setEditingUserId(null);
    setEditingData(null);
  };

  const saveChanges = async () => {
    if (!editingData) return;

    // Call API to save changes
    try {
      const config = addAuthorizationHeader({});

      const originalUser = users.find(u => u.user_id === editingData.user_id);
      if (!originalUser) {
        setErrorMessage('Original user data not found.');
        return;
      }

      let data = {};
      if (editingData.name !== originalUser.name) {
        data = { ...data, name: editingData.name };
      }

      if (editingData.email !== originalUser.email) {
        data = { ...data, email: editingData.email };
      }

      if (editingData.role !== originalUser.role) {
        data = { ...data, role: editingData.role };
      }

      if (editingData.password && editingData.password.trim() !== '') {
        data = { ...data, password: editingData.password };
      }

      if (Object.keys(data).length > 0) {
        const modifyResult = await axiosClient.patch<SuccessResponse>(
          `/admin/modify/${editingUserId}`,
          data,
          config
        );

        if (modifyResult.data.message) {
          console.log("Modify Success:", modifyResult.data.message);
        }
      }

      // If archived status changed, call archive/unarchive endpoint
      if (originalUser.archived !== editingData.archived) {
        const archiveEndpoint = editingData.archived ? 'archive' : 'activate';
        const archiveResult = await axiosClient.patch<SuccessResponse>(`/admin/${archiveEndpoint}/${editingData.user_id}`, {}, config);
        if (archiveResult.data.message) {
          console.log(`${archiveEndpoint.charAt(0).toUpperCase() + archiveEndpoint.slice(1)} Success:`, archiveResult.data.message);
        }
      }
    } catch (error) {
      console.error("Error updating user:", error);
      setErrorMessage((error as Error).message || 'Failed to update user.');
      return;
    }

    // Update the user in the list
    setUsers(users.map(user =>
      user.user_id === editingData.user_id
        ? {
          user_id: editingData.user_id,
          name: editingData.name,
          email: editingData.email,
          role: editingData.role,
          archived: editingData.archived
        }
        : user
    ));

    // Show success message
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);

    // Clear editing state
    setEditingUserId(null);
    setEditingData(null);
  };

  const deleteUser = async (userId: string) => {
    if (!confirm(`Are you sure you want to delete user ${userId}?`)) {
      return;
    }

    try {
      const config = addAuthorizationHeader({});
      const result = await axiosClient.delete<SuccessResponse>(
        `/admin/delete/${userId}`,
        config
      );

      if (result.data.message) {
        console.log("Delete Success:", result.data.message);
        // Remove user from the list
        setUsers(users.filter(user => user.user_id !== userId));
        // Show success message
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setErrorMessage((error as Error).message || 'Failed to delete user.');
    }
  };

  const handleInputChange = (field: keyof EditingUser, value: string | boolean) => {
    if (!editingData) return;
    setEditingData({ ...editingData, [field]: value });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-8 py-6">
        <h1 className="text-3xl font-semibold mb-6">User List</h1>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-600">Loading...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-8 py-6">
        <h1 className="text-3xl font-semibold mb-6">User List</h1>
        <div className="flex justify-center items-center h-64">
          <div className="text-red-600">Error loading data.</div>
        </div>
      </div>
    )
  }

  if (!apiResponse || apiResponse.users.length === 0) {
    return (
      <div className="container mx-auto px-8 py-6">
        <h1 className="text-3xl font-semibold mb-6">User List</h1>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-600">No users available.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-8 py-6">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-6">User List</h1>
      </div>

      {/* Success Message */}
      {showSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          <span>User information updated successfully.</span>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* User Table */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  User ID
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Password
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => {
                const isEditing = editingUserId === user.user_id;
                const isAdmin = user.user_id === 'admin';

                return (
                  <tr key={user.user_id} className={`${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'} transition-colors`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm ${isAdmin ? 'font-semibold text-red-600' : 'text-gray-900'}`}>
                        {user.user_id}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingData?.name || ''}
                          onChange={(e) => handleInputChange('name', e.target.value)}
                          className="w-full px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-sm text-gray-900">{user.name}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="email"
                          value={editingData?.email || ''}
                          onChange={(e) => handleInputChange('email', e.target.value)}
                          className="w-full px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-sm text-gray-900">{user.email || '-'}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="password"
                          value={editingData?.password || ''}
                          onChange={(e) => handleInputChange('password', e.target.value)}
                          placeholder="Enter new password"
                          className="w-full px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="text-sm text-gray-500">******</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditing ? (
                        <select
                          value={editingData?.role || 'student'}
                          onChange={(e) => handleInputChange('role', e.target.value)}
                          className="w-full px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="student">student</option>
                          <option value="manager">manager</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${user.role === 'admin'
                            ? 'bg-red-100 text-red-800'
                            : user.role === 'manager'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-800'
                            }`}
                        >
                          {user.role}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {isEditing ? (
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!editingData?.archived}
                            onChange={(e) => handleInputChange('archived', !e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="ml-2 text-sm text-gray-700">
                            {editingData?.archived ? 'Inactive' : 'Active'}
                          </span>
                        </label>
                      ) : (
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${user.archived
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-green-100 text-green-800'
                          }`}>
                          {user.archived ? 'Inactive' : 'Active'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={saveChanges}
                            className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                          >
                            <Save className="w-4 h-4 mr-1" />
                            Save
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            <X className="w-4 h-4 mr-1" />
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => startEditing(user)}
                            disabled={isAdmin}
                            className={`inline-flex items-center px-3 py-1 border text-sm font-medium rounded-md ${isAdmin
                              ? 'border-gray-200 text-gray-400 bg-gray-100 cursor-not-allowed'
                              : 'border-transparent text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-offset-2 focus:ring-blue-500'
                              }`}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteUser(user.user_id)}
                            disabled={isAdmin}
                            className={`inline-flex items-center px-3 py-1 border text-sm font-medium rounded-md ${isAdmin
                              ? 'border-gray-200 text-gray-400 bg-gray-100 cursor-not-allowed'
                              : 'border-transparent text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-offset-2 focus:ring-red-500'
                              }`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}

export default UserList;
