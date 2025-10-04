import React from 'react';
import { useState, useEffect, useMemo } from 'react';
import styled from 'styled-components';
import { useAuth } from '../context/AuthContext';
import useApiClient from '../hooks/useApiClient';
import SearchIconSVG from '../images/Search.svg';
import ButtonComponent from '../components/ButtonComponent';
import { fetchBatchSubmissionDetail } from '../api/GetAPI';
import { BatchSubmissionDetailItem, BatchSubmissionItemsForListView } from '../types/Assignments';
import { useParams, useNavigate } from 'react-router-dom';
import LoadingComponent from '../components/LoadingComponent';
import StatusButton from '../components/StatusButtonComponent';
import { SubmissionSummaryStatus } from '../types/Assignments';

const MAX_DATA_COUNT = 20;

type ColumnDefinition = {
    key: string;
    label: string;
    sortable: boolean;
    filterType?: "search" | "checkbox";
    filterOptions?: { value: string; label: string }[];
};

const columnDefinitions: ColumnDefinition[] = [
    { 
        key: "user", 
        label: "ユーザー", 
        sortable: true, 
        filterType: "search" 
    },
    { key: "ts", label: "提出日時", sortable: true },
    { 
        key: "report", 
        label: "レポート", 
        sortable: false, 
        filterType: "checkbox",
        filterOptions: [
            { value: "submitted", label: "提出" },
            { value: "delay", label: "遅延" },
            { value: "non-submitted", label: "未提出" },
        ]
    },
];

type FilterState = {
    activeKey: string | null;
    value: string;
};



const BatchDetailPage: React.FC = () => {
    const { apiClient } = useApiClient();
    const { batchId } = useParams<{ batchId: string }>();
    const [batchSubmissions, setBatchSubmissions] = useState<BatchSubmissionDetailItem | null>(null);
    const { token } = useAuth();
    const [sortKey, setSortKey] = useState<string>('user');
    const [sortOrder, setSortOrder] = useState<string>('asc');
    const [columns, setColumns] = useState<ColumnDefinition[]>(columnDefinitions);
    const [filterState, setFilterState] = useState<FilterState>({
        activeKey: null,
        value: ''
    });
    const navigate = useNavigate();

    
    const getSubmissions = async (batchId: string) => {
        const batchSubmissionDetail = await apiClient({ apiFunc: fetchBatchSubmissionDetail, args: [parseInt(batchId)] });
        setBatchSubmissions(batchSubmissionDetail);
        return batchSubmissionDetail;
    };

    useEffect(() => {
        if (!batchId) return;
        getSubmissions(batchId);
    }, [token, batchId]);

    useEffect(() => {
        if (batchSubmissions?.lecture?.problems) {
            const problemColumns = batchSubmissions.lecture.problems.map(problem => ({
                key: `problem_${problem.assignment_id}`,
                label: problem.title,
                sortable: false,
                filterType: "checkbox" as const,
                filterOptions: [
                { value: "AC", label: "AC" },
                { value: "WA", label: "WA" },
                { value: "error", label: "エラー" },
                { value: "non-submitted", label: "未提出" },
                ]
            }));
            setColumns([...columnDefinitions, ...problemColumns]);
        }
    }, [batchSubmissions]);

    // ソート機能の実装
    const sortedSubmissions = useMemo(() => {
        if (!batchSubmissions?.evaluation_statuses) return [];

        return [...batchSubmissions.evaluation_statuses].sort((a, b) => {
            if (sortKey === 'ts') {
                // submit_dateがnullの場合の処理
                if (a.submit_date === null && b.submit_date === null) {
                    // 両方nullの場合はuser_idでソート
                    return sortOrder === 'asc'
                        ? a.user_id.localeCompare(b.user_id)
                        : b.user_id.localeCompare(a.user_id);
                }
                if (a.submit_date === null) return sortOrder === 'asc' ? 1 : -1;
                if (b.submit_date === null) return sortOrder === 'asc' ? -1 : 1;
                
                // どちらもnullでない場合は日付でソート
                return sortOrder === 'asc' 
                    ? new Date(a.submit_date).getTime() - new Date(b.submit_date).getTime()
                    : new Date(b.submit_date).getTime() - new Date(a.submit_date).getTime();
            }
            if (sortKey === 'user') {
                return sortOrder === 'asc'
                    ? a.user_id.localeCompare(b.user_id)
                    : b.user_id.localeCompare(a.user_id);
            }
            return 0;
        });
    }, [batchSubmissions, sortKey, sortOrder]);

    const filteredSubmissions = useMemo(() => {
        if (!sortedSubmissions) return [];
        return sortedSubmissions.filter((submission) => {
            if (!filterState.activeKey || !filterState.value) return true;
            
            const column = columns.find(col => col.key === filterState.activeKey);
            if (!column) return true;

            const filterValues = filterState.value.split(',');
            if (filterValues.length === 0) return true;

            if (column.filterType === 'search') {
                const searchValue = filterState.value.toLowerCase();
                if (column.key === 'user') {
                    return submission.user_id.toLowerCase().includes(searchValue) || 
                            submission.username.toLowerCase().includes(searchValue);
                }
            } else if (column.filterType === 'checkbox') {
                // レポートのフィルタリング
                if (column.key === 'report') {
                    if (!submission.report_exists) {
                        return filterValues.includes('non-submitted');
                    }
                    if (submission.status !== "submitted") {
                        console.log(submission.status);
                        console.log(filterValues);
                    }
                    return filterValues.includes(submission.status);
                }
                
                // 問題のフィルタリング
                if (column.key.startsWith('problem_')) {
                    const assignmentId = parseInt(column.key.split('_')[1]);
                    const submissionResult = submission.submissions.find(
                        sub => sub.assignment_id === assignmentId
                    );

                    if (!submissionResult) {
                        return filterValues.includes('non-submitted');
                    }

                    const result = submissionResult.result;
                    
                    if (filterValues.includes('error')) {
                        // エラーフィルター: ACとWA以外のすべてのステータス
                        return result && 
                                result !== "AC" && 
                                result !== "WA";
                    }
                    
                    return result && filterValues.includes(result);
                }
            }
            return true;
        });
    }, [sortedSubmissions, filterState, columns]);


    const handleFilterSelect = (column: ColumnDefinition | null) => {
        setFilterState(prevState => ({
        ...prevState,
        activeKey: column?.key || null,
        value: ''
    }));
    };

    const handleFilterChange = (key: string | null, value: string) => {
        setFilterState(prevState => {
            if (key === null) {
                return {
                    ...prevState,
                    activeKey: null,
                    value: ''
                };
            }

            if (key !== prevState.activeKey) {
                return prevState;
            }

            // チェックボックスの場合の処理を修正
            if (columns.find(col => col.key === prevState.activeKey)?.filterType === 'checkbox') {
                const currentValues = prevState.value.split(',').filter(v => v);
                if (currentValues.includes(value)) {
                    // チェックが外された場合、該当の値を除外
                    const newValues = currentValues.filter(v => v !== value);
                    return {
                        ...prevState,
                        value: newValues.join(',')
                    };
                } else {
                    // チェックが付けられた場合、値を追加
                    return {
                        ...prevState,
                        value: prevState.value ? `${prevState.value},${value}` : value
                    };
                }
            }

            // 検索フィルターの場合はそのまま
            return {
                ...prevState,
                value: value
            };
        });
    };



    const handleSort = (key: string, order: string) => {
        setSortKey(key);
        setSortOrder(order);
    };

    const handleStatusClick = (userId: string, openingData: string) => {
        navigate(`/batch/result/${batchId}/user/${userId}`, {
            state: { openingData }
        });
    };


    if (!batchSubmissions) {
        return <div>
            <h1>採点履歴</h1>
            <LoadingComponent message="読み込み中..." />
        </div>;
    }

    return <PageContainer>
        <h1>採点履歴</h1>
        <h2>{batchSubmissions.lecture.title}</h2>
        <div style={{ fontSize: '14px', color: '#808080' }}>提出: {batchSubmissions.ts.toLocaleString()}, 提出者: {batchSubmissions.username}</div>
        <Divider style={{ height: '3px', marginBottom: '20px', borderRadius: '2px' }} />
        <BatchStatusContainer>
            <FixedContent>
                <ToolBarContainer>
                    <FilterDropdown
                        value={filterState.activeKey || ''}
                        onChange={(e) => {
                            const selected = columns.find(col => col.key === e.target.value);
                            if (selected) handleFilterSelect(selected);
                            else handleFilterSelect(null);
                        }}
                    >
                        <option value="">フィルター項目を選択</option>
                        {columns.filter(column => column.filterType).map((column) => (
                            <option key={column.key} value={column.key}>
                                {column.label}
                            </option>
                        ))}
                    </FilterDropdown>
                    {filterState.activeKey && (
                        columns.find(col => col.key === filterState.activeKey)?.filterType === 'search' ? (
                            <SearchInputWrapper>
                                <SearchInput
                                    type="text"
                                    value={filterState.value}
                                    onChange={(e) => handleFilterChange(filterState.activeKey, e.target.value)}
                                    placeholder={`${columns.find(col => col.key === filterState.activeKey)?.label}で検索`}
                                />  
                                <SearchIcon src={SearchIconSVG} alt="検索" />
                            </SearchInputWrapper>
                        ) : (
                            <FilterOptionsContainer>
                                {columns.find(col => col.key === filterState.activeKey)?.filterOptions?.map(option => (
                                    <CheckboxContainer key={option.value}>
                                        <Checkbox 
                                            type="checkbox"
                                            value={option.value}
                                            onChange={(e) => handleFilterChange(filterState.activeKey, e.target.value)}
                                        />
                                        <StyledStatusButton status={option.label as any} isButton={false} />
                                    </CheckboxContainer>
                                ))}
                            </FilterOptionsContainer>
                            )
                        )}
                    <div style={{ flexGrow: 1 }} />
                </ToolBarContainer>
                <HeaderContainer>
                    {columns.map((header, index) => (
                        <HeaderItem key={index}>
                            <span>{header.label}</span>
                            {header.sortable && (
                                <SortButtons>
                                    <SortButton onClick={() => handleSort(header.key, 'asc')}>▲</SortButton>
                                    <SortButton onClick={() => handleSort(header.key, 'desc')}>▼</SortButton>
                                </SortButtons>
                            )}
                        </HeaderItem>
                    ))}
                    <div style={{ flexGrow: 1 }} />
                </HeaderContainer>
            </FixedContent>
            <ScrollableContent>
                <SubmissionListContainer>
                    {filteredSubmissions.map((submission, index) => (
                        <React.Fragment key={submission.id}>
                            <UserItemContainer>
                                <UserInfoItem>
                                    {submission.username}<br />
                                    {submission.user_id}
                                </UserInfoItem>
                                <UserInfoItem>
                                    {submission.submit_date ? submission.submit_date.toLocaleString() : '-'}
                                </UserInfoItem>
                                <UserInfoItem>
                                    <StyledStatusButton 
                                        status={submission.status === "non-submitted" ? "未提出" : submission.status === "submitted" ? "提出" : "遅延"} 
                                        isButton={true}
                                        onClick={() => handleStatusClick(submission.user_id, "レポート")}
                                    />
                                </UserInfoItem>
                                {batchSubmissions.lecture.problems.map(problem => (
                                    <UserInfoItem key={problem.assignment_id}>
                                        <StyledStatusButton 
                                            status={
                                                submission.submissions.find(sub => sub.assignment_id === problem.assignment_id)
                                                    ? submission.submissions.find(sub => sub.assignment_id === problem.assignment_id)?.result || "エラー"
                                                    : "未提出"
                                            } 
                                            isButton={true}
                                            onClick={() => handleStatusClick(submission.user_id, problem.title)}
                                        />
                                    </UserInfoItem>
                                ))}
                                <UserInfoItem>
                                    <LinkButton 
                                        onClick={(e) => {
                                            e.preventDefault();
                                            handleStatusClick(submission.user_id, "ステータス");
                                        }}
                                        href={`/batch/result/${batchId}/user/${submission.user_id}`}
                                    >
                                        詳細
                                    </LinkButton>
                                </UserInfoItem>
                            </UserItemContainer>
                            {index < filteredSubmissions.length - 1 && <Divider />}
                        </React.Fragment>
                    ))}
                </SubmissionListContainer>
            </ScrollableContent>
        </BatchStatusContainer>
    </PageContainer>;
}


export default BatchDetailPage;

const PageContainer = styled.div`
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding-bottom: 50px;

    h2 {
        margin: 5px 0 5px;
    }
`;

const BatchStatusContainer = styled.div`
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
    flex-direction: row;
    background-color: #B8B8B8;
    padding: 10px;
    gap: 10px;
`;

const SubmissionListContainer = styled.div`
    padding: 0px 10px 10px 10px;
`;

const UserItemContainer = styled.div`
    display: flex;
    flex-direction: row;
    padding: 10px;
    gap: 10px;
`;

const UserInfoItem = styled.div`
    flex: 1;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-height: 40px;
`;

const FilterDropdown = styled.select`
    border-radius: 6px;
    border: 1px solid #B8B8B8;
    padding: 0 8px;
    margin-right: 30px;
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

const HeaderItem = styled.div`
    flex: 1;
    font-size: 25px;
    font-family: Inter;
    font-weight: 600;
    color: #FFFFFF;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
`;

const SortButtons = styled.div`
    display: flex;
    flex-direction: column;
    margin-left: 8px;  // ラベルとの間隔を調整
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

const LinkButton = styled.a`
    color: #0000EE;
    text-decoration: none;
    &:hover {
        text-decoration: underline;
    }
`

const CheckboxContainer = styled.label`
    display: inline-flex;
    align-items: center;
    margin: 0 30px 0 0;
    cursor: pointer;
`;

const Checkbox = styled.input`
    cursor: pointer;
    margin-right: 5px;
`;

const FilterOptionsContainer = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
`;

const StyledStatusButton = styled(StatusButton)`
    cursor: pointer;
`;

