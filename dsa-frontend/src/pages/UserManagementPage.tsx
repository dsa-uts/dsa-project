import React from 'react';
import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { fetchUserList } from '../api/GetAPI';
import { useAuth } from '../context/AuthContext';
import useApiClient from '../hooks/useApiClient';
import { User } from '../types/user';
import SearchIconSVG from '../images/Search.svg';
import ButtonComponent from '../components/ButtonComponent';
import { useNavigate } from 'react-router-dom';
import { UserRole } from '../types/token';
import Dialog from '../components/DialogComponent';
import { deleteUsers } from '../api/DeleteAPI';

const MAX_DATA_COUNT = 200;

const UserManagementPage: React.FC = () => {
    const navigate = useNavigate();
    const { apiClient } = useApiClient();
    const [users, setUsers] = useState<User[]>([]);
    const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
    const [filterKey, setFilterKey] = useState<string>('');
    const [searchCondition, setSearchCondition] = useState<string>('');
    const [checkedUsers, setCheckedUsers] = useState<string[]>([]);
    const [sortKey, setSortKey] = useState<string>('user_id');
    const [sortOrder, setSortOrder] = useState<string>('asc');
    const [isOpenDialog, setIsOpenDialog] = useState<boolean>(false);
    const { token, user_id, role } = useAuth();

    const headerContents = [ 
        { label: 'ユーザー', sortLabel: 'user_id', sortable: true, filterable: true },
        { label: 'ロール', sortLabel: '', sortable: false, filterable: true },
        { label: '状態', sortLabel: '', sortable: false, filterable: true },
        { label: '作成日', sortLabel: '', sortable: false, filterable: false },
        { label: '更新日', sortLabel: '', sortable: false, filterable: false },
        { label: '有効期間', sortLabel: '', sortable: false, filterable: false },
        { label: '', sortLabel: '', sortable: false, filterable: false } // 編集ボタン用のスペース
    ];

    useEffect(() => {
        const getUsers = async () => {
            const userList = await apiClient({ apiFunc: fetchUserList, args: role === UserRole.admin ? [null, null] : [user_id, ['student']] });
            setUsers(userList);
            setFilteredUsers(userList);
        };
        getUsers();
    }, [token, user_id]);

    useEffect(() => {
        const sortedUsers = [...filteredUsers].sort((a, b) => {
            if (sortKey === 'user_id') {
                return sortOrder === 'asc' 
                    ? a.user_id.localeCompare(b.user_id)
                    : b.user_id.localeCompare(a.user_id);
            }
            return 0;
        });
        setFilteredUsers(sortedUsers);
    }, [sortKey, sortOrder]);

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            const allFilteredUserIdsExcludeMe = filteredUsers.map(user => user.user_id).filter(id => id !== user_id);
            setCheckedUsers(allFilteredUserIdsExcludeMe);
        } else {
            setCheckedUsers([]);
        }
    };

    const handleSelectUser = (id: string) => {
        if (checkedUsers.includes(id)) {
            setCheckedUsers(checkedUsers.filter(userId => userId !== id));
        } else {
            setCheckedUsers([...checkedUsers, id]);
        }
    };

    const handleSort = (key: string, order: string) => {
        setSortKey(key);
        setSortOrder(order);
    };


    useEffect(() => {
        const handleFilter = () => {
            const filteredUsers = users.filter(user => {
            if (!filterKey || searchCondition.trim() === '') return true;
            
            switch (filterKey) {
                case 'ユーザー':
                    return user.user_id.toLowerCase().includes(searchCondition.toLowerCase()) || user.username.toLowerCase().includes(searchCondition.toLowerCase());
                case 'ロール':
                    return user.role.toLowerCase().includes(searchCondition.toLowerCase());
                case '状態':
                    return searchCondition.toLowerCase() === 'active' ? !user.disabled : (searchCondition.toLowerCase() === 'disactive' ? user.disabled : true);
                default:
                    return true;
                }
            });
            
            setFilteredUsers(filteredUsers);
        };
        handleFilter();
    }, [filterKey, searchCondition]);

    const handleOpenDialog = () => {
        setIsOpenDialog(true);
    };

    const handleCloseDialog = () => {
        setIsOpenDialog(false);
    };

    const handleDeleteUsers = async () => {
        if (checkedUsers.length === 0) {
            alert('削除するユーザーを選択してください。');
            return;
        }
        
        try {
            await apiClient({ apiFunc: deleteUsers, args: [checkedUsers] });
            alert('選択されたユーザーが正常に削除されました。');
            const updatedUserList = await apiClient({ apiFunc: fetchUserList, args: role === UserRole.admin ? [null, null] : [user_id, ['student']] });
            setUsers(updatedUserList);
            setFilteredUsers(updatedUserList);
            setCheckedUsers([]);
        } catch (error) {
            console.error('ユーザーの削除に失敗しました。', error);
            alert(`ユーザーの削除に失敗しました: ${(error as any).response.data.detail}`);
        }
        setIsOpenDialog(false)
    };

    return <PageContainer>
        <h1>ユーザー管理</h1>
        <UserManagementContainer>
            <FixedContent>
                <ToolBarContainer>
                    <FilterDropdown
                        value={filterKey}
                        onChange={(e) => setFilterKey(e.target.value)}
                    >
                        <option value="">フィルター項目を選択</option>
                        {headerContents.filter((header) => header.filterable).map((header) => (
                            <option key={header.label} value={header.label}>
                                {header.label}
                            </option>
                        ))}
                    </FilterDropdown>
                    <SearchInputWrapper>
                        <SearchInput
                            type="text"
                            value={searchCondition}
                            onChange={(e) => setSearchCondition(e.target.value)}
                            placeholder={filterKey ? `${filterKey}で検索` : 'フィルター項目を選択してください'}
                            disabled={!filterKey}
                        />
                        <SearchIcon src={SearchIconSVG} alt="検索" />
                    </SearchInputWrapper>
                    <div style={{ flexGrow: 1 }} />
                    {checkedUsers.length > 0 ? 
                        <ButtonComponent 
                            onClick={handleOpenDialog}
                            label="選択したユーザーを削除"
                            height="40px"
                            width="200px"
                        /> : 
                        <ButtonComponent 
                            onClick={() => navigate('/users/register')}
                            label="ユーザーを追加"
                            height="40px"
                            width='200px'
                        />
                    }
                </ToolBarContainer>
                <HeaderContainer>
                    <CheckboxContainer>
                        <Checkbox
                            type="checkbox"
                            onChange={handleSelectAll}
                            checked={checkedUsers.length === users.length - 1}
                        />
                    </CheckboxContainer>
                    {headerContents.map((header, index) => (
                        <HeaderItem key={index}>
                            {header.label}
                            {header.sortable && (
                                <SortButtons>
                                    <SortButton onClick={() => handleSort(header.sortLabel, 'asc')}>▲</SortButton>
                                    <SortButton onClick={() => handleSort(header.sortLabel, 'desc')}>▼</SortButton>
                                </SortButtons>
                            )}
                        </HeaderItem>
                    ))}
                </HeaderContainer>
            </FixedContent>
            <ScrollableContent>
                <UserListContainer>
                    {filteredUsers.map((user, index) => (
                        <React.Fragment key={user.user_id}>
                            <UserItemContainer>
                                <CheckboxContainer>
                                    <Checkbox
                                        type="checkbox"
                                        onChange={() => handleSelectUser(user.user_id)}
                                        checked={checkedUsers.includes(user.user_id)}
                                        disabled={user.user_id === user_id}
                                    />
                                </CheckboxContainer>
                                <UserInfoItem>
                                    {user.username}<br />
                                    {user.user_id}
                                </UserInfoItem>
                                <UserInfoItem>{user.role}</UserInfoItem>
                                <UserInfoItem>{user.disabled ? 'Disactive' : 'Active'}</UserInfoItem>
                                <UserInfoItem>{user.created_at.toLocaleString()}</UserInfoItem>
                                <UserInfoItem>{user.updated_at.toLocaleString()}</UserInfoItem>
                                <UserInfoItem>
                                    {`from: ${user.active_start_date}`}<br />
                                    {`to: ${user.active_end_date}`}
                                </UserInfoItem>
                                <UserInfoItem>
                                    <ButtonComponent
                                        onClick={() => navigate(`/users/edit/${user.user_id}`)}
                                        label="編集"
                                        height="40px"
                                    />
                                </UserInfoItem>
                            </UserItemContainer>
                            {index < filteredUsers.length - 1 && <Divider />}
                        </React.Fragment>
                    ))}
                </UserListContainer>
            </ScrollableContent>
        </UserManagementContainer>
        {isOpenDialog && (
                <Dialog
                    title="ユーザーの削除"
                    body={<div style={{ whiteSpace: 'pre-wrap' }}>
                            以下のユーザーを削除します。
                            <ul>
                                {users.filter(user => checkedUsers.includes(user.user_id)).map(user => <li>{`${user.username} (${user.user_id})`}</li>)}
                            </ul>
                        </div>}
                    buttons={[
                        <ButtonComponent
                            key="cancel"
                            label="キャンセル"
                            onClick={handleCloseDialog}
                            width="150px"
                            height="40px"
                        />,
                        <ButtonComponent
                            key="delete"
                            label="削除"
                            onClick={handleDeleteUsers}
                            width="150px"
                            height="40px"
                        />,
                    ]}
                    onClose={handleCloseDialog}
                />
            )}
    </PageContainer>;
}

export default UserManagementPage;

const PageContainer = styled.div`
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding-bottom: 50px;
`;

const UserManagementContainer = styled.div`
    flex: 1;
    display: flex;
    flex-direction: column;
    background: white;
    box-shadow: 0px 0px 5px rgba(0, 0, 0, 0.20);
    border-radius: 8px;
    overflow: hidden;
`;

const FixedContent = styled.div`
    flex-shrink: 0;
`;

const ScrollableContent = styled.div`
    flex: 1;
    overflow-y: auto;
`;

const ToolBarContainer = styled.div`
    display: flex;
    align-items: center;
    padding: 10px;
`;

const HeaderContainer = styled.div`
    display: flex;
    background-color: #B8B8B8;
    padding: 10px;
    font-weight: bold;
`;

const UserListContainer = styled.div`
    padding: 10px;
`;

const UserItemContainer = styled.div`
    display: flex;
    flex-direction: row;
    padding: 10px 0;
    align-items: center;
    min-height: 40px;
`;

const UserInfoItem = styled.div`
    font-size: 14px;
    flex: 1;
    padding: 0 10px;
    display: flex;
    align-items: center;
`;

const FilterDropdown = styled.select`
    border-radius: 6px;
    border: 1px solid #B8B8B8;
    padding: 0 8px;
    margin-right: 8px;
    height: 40px;
    font-size: 14px;
    box-sizing: border-box;
    padding-right: 24px;
    cursor: pointer;
`;

const SearchInputWrapper = styled.div`
    position: relative;
    display: flex;
    align-items: center;
`;

const SearchIcon = styled.img`
    position: absolute;
    left: 8px;
    width: 20px;
    height: 20px;
    pointer-events: none;
`;

const SearchInput = styled.input`
    border-radius: 6px;
    border: 1px solid #B8B8B8;
    padding: 0 8px 0 32px;
    margin-right: 8px;
    width: 400px;
    height: 40px;
    font-size: 14px;
    box-sizing: border-box;
    color: #000000;
    &::placeholder {
        color: rgba(0, 0, 0, 0.5);
    }
`;

const CheckboxContainer = styled.div`
    width: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 0 10px;
`;

const Checkbox = styled.input`
    width: 20px;
    height: 20px;
    cursor: pointer;
`;

const HeaderItem = styled.div`
    font-size: 25px;
    font-family: Inter;
    font-weight: 600;
    color: #FFFFFF;
    display: flex;
    align-items: center;
    padding: 0 10px;
    flex: 1;
`;

const SortButtons = styled.div`
    display: flex;
    flex-direction: column;
    margin-left: 5px;
`;

const SortButton = styled.button`
    background: none;
    border: none;
    color: white;
    font-size: 15px;
    cursor: pointer;
    padding: 0;
    line-height: 1;

    &:hover {
        color: #ddd;
    }
`;

const Divider = styled.hr`
    border: none;
    height: 1px;
    background-color: #E0E0E0;
    margin: 0;
`;
