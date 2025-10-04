import React from 'react';
import { useState, useEffect } from 'react';
import styled from 'styled-components';
import { useAuth } from '../context/AuthContext';
import useApiClient from '../hooks/useApiClient';
import SearchIconSVG from '../images/Search.svg';
import ButtonComponent from '../components/ButtonComponent';
import { fetchBatchSubmissionList } from '../api/GetAPI';
import { BatchSubmissionItemsForListView } from '../types/Assignments';
import LoadingComponent from '../components/LoadingComponent';


const MAX_DATA_COUNT = 20;
/*
* API呼び出しのタイミング
* 1. ページネーションのボタンを押した時
* 2. 検索ボタンを押す/エンター機を押した時
* 3. 以前検索した状態から初めて検索ボックスが空になった時
* 4. ソートした時
* 5. complete_judge !== total_judge || status !== 'done' のsubmissionがある時．
* 6. 初回読み込み時
*/

const BatchStatusPage: React.FC = () => {
    const { apiClient } = useApiClient();
    const [submissions, setSubmissions] = useState<BatchSubmissionItemsForListView | null>(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(MAX_DATA_COUNT);
    const { token } = useAuth();
    const [filterKey, setFilterKey] = useState<string>('');
    const [searchCondition, setSearchCondition] = useState<string>('');
    const [appliedSearchCondition, setAppliedSearchCondition] = useState<string>('');
    const [sortKey, setSortKey] = useState<string>('ts');
    const [sortOrder, setSortOrder] = useState<string>('desc');
    const [dots, setDots] = useState<string>('.');
    const [inProgress, setInProgress] = useState<boolean>(true);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    const headerContents = [ 
        { label: '提出日時', sortLabel: 'ts', sortable: true, filterable: false },
        { label: '課題', sortLabel: 'lecture_id', sortable: true, filterable: true },
        { label: 'ユーザー', sortLabel: 'user_id', sortable: true, filterable: true },
        { label: '', sortLabel: '', sortable: false, filterable: false },
    ];

    const getSubmissions = async (currentSearchCondition: string = appliedSearchCondition) => {
        let args;
        if (!filterKey || currentSearchCondition.trim() === '') {
            args = [page, pageSize, null, null, sortKey, sortOrder];
        } else if (filterKey === '課題') {
            args = [page, pageSize, currentSearchCondition.trim(), null, sortKey, sortOrder];
        } else if (filterKey === 'ユーザー') {
            args = [page, pageSize, null, currentSearchCondition.trim(), sortKey, sortOrder];
        } else {
            alert('フィルタ項目が不正です');
        }
        const submissionList = await apiClient({ apiFunc: fetchBatchSubmissionList, args: args });
        setSubmissions(submissionList);
        return submissionList;
    };

    useEffect(() => {
        const checkAndUpdateProgress = (submissionList: BatchSubmissionItemsForListView) => {
            const hasIncompleteSubmissions = submissionList.items.some(submission => 
                submission.complete_judge !== submission.total_judge || submission.status !== 'done'
            );
            setInProgress(hasIncompleteSubmissions);
        };

        const fetchAndUpdate = async () => {
            try {
                const submissionList = await getSubmissions(appliedSearchCondition);
                if (submissionList) {
                    checkAndUpdateProgress(submissionList);
                } else {
                    console.error('Submission list is undefined');
                    setInProgress(false);
                }
            } catch (error) {
                console.error('Error fetching submissions:', error);
                setInProgress(false);
            }
            setIsLoading(false);
        };

        fetchAndUpdate();

        let intervalId: NodeJS.Timeout | null = null;

        if (inProgress) {
            intervalId = setInterval(fetchAndUpdate, 5000);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [token, page, pageSize, sortKey, sortOrder, inProgress, appliedSearchCondition]);


    useEffect(() => {
        let dotsInterval: NodeJS.Timeout | null = null;

        if (inProgress) {
            dotsInterval = setInterval(() => {
                setDots(prevDots => {
                    if (prevDots === '...') return '.';
                    return prevDots + '.';
                });
            }, 500);
        } else {
            setDots('');
        }

        return () => {
            if (dotsInterval) clearInterval(dotsInterval);
        };
    }, [inProgress]);

    const handleSort = (key: string, order: string) => {
        setSortKey(key);
        setSortOrder(order);
    };

    const handleSearch = (event?: React.FormEvent) => {
        if (event) {
            event.preventDefault();
        }
        setAppliedSearchCondition(searchCondition);
    };

    const handleFilterKeyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newFilterKey = e.target.value;
        setFilterKey(newFilterKey);
        // filterKey が空になった場合、検索を実行
        if (newFilterKey === '') {
            setSearchCondition('');
            setAppliedSearchCondition('');
            getSubmissions('');
        }
    };

    const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newSearchCondition = e.target.value;
        setSearchCondition(newSearchCondition);
        // 検索条件が空になった場合、検索を実行
        if (newSearchCondition === '') {
            setAppliedSearchCondition('');
        }
    };

    if (isLoading || !submissions) {
        return <div>
            <h1>採点履歴</h1>
            <LoadingComponent message="読み込み中..." />
        </div>;
    }


    return <PageContainer>
        <h1>採点履歴</h1>
        <BatchStatusContainer>
            <FixedContent>
                <ToolBarContainer>
                    <FilterDropdown
                        value={filterKey}
                        onChange={handleFilterKeyChange}
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
                            onChange={handleSearchInputChange}
                            onKeyDown={(e) => {if (e.key === 'Enter') {handleSearch();}}}
                            placeholder={filterKey ? `${filterKey}で検索` : 'フィルター項目を選択してください'}
                            disabled={!filterKey}
                        />
                        <SearchIcon src={SearchIconSVG} alt="検索" />
                    </SearchInputWrapper>
                    <ButtonComponent onClick={handleSearch} label="検索" disabled={!filterKey} height="40px" />
                    <div style={{ flexGrow: 1 }} />
                    <ButtonComponent
                        onClick={() => setPage(Math.max(page - 1, 1))}
                        label="< Prev"
                        height="40px"
                        disabled={page <= 1}
                        style={{ marginRight: '10px' }}
                    />
                    <ButtonComponent
                        onClick={() => setPage(Math.min(page + 1, submissions.total_pages))}
                        label="Next >"
                        height="40px"
                        disabled={page >= submissions.total_pages}
                    />
                </ToolBarContainer>
                <HeaderContainer>
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
                <SubmissionListContainer>
                    {submissions.items.map((submission, index) => (
                        <React.Fragment key={submission.id}>
                            <UserItemContainer>
                                <UserInfoItem>{submission.ts.toLocaleString()}</UserInfoItem>
                                <UserInfoItem>
                                    <LinkButton href={`https://www.coins.tsukuba.ac.jp/~amagasa/lecture/dsa-jikken/report${submission.lecture_id}/`} target="_blank" rel="noopener noreferrer">
                                        {submission.lecture_title}
                                    </LinkButton>
                                </UserInfoItem>
                                <UserInfoItem>
                                    {submission.username}<br />
                                    {submission.user_id}
                                </UserInfoItem>
                                { submission.complete_judge !== submission.total_judge ? 
                                    <UserInfoItem>{submission.complete_judge}/{submission.total_judge}{dots}</UserInfoItem> : 
                                    <UserInfoItem>
                                        <LinkButton href={`/batch/result/${submission.id}`}>詳細</LinkButton>
                                    </UserInfoItem>
                                }
                            </UserItemContainer>
                            {index < submissions.items.length - 1 && <Divider />}
                        </React.Fragment>
                    ))}
                </SubmissionListContainer>
            </ScrollableContent>
        </BatchStatusContainer>
    </PageContainer>;
}


export default BatchStatusPage;

const PageContainer = styled.div`
    height: 100vh;
    display: flex;
    flex-direction: column;
    padding-bottom: 50px;
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
    background-color: #B8B8B8;
    padding: 10px;
    font-weight: bold;
`;

const SubmissionListContainer = styled.div`
    padding: 0px 10px 10px 10px;
`;

const UserItemContainer = styled.div`
    display: flex;
    flex-direction: row;
    padding: 10px 0;
    align-items: center;
    min-height: 30px;
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

const LinkButton = styled.a`
    color: #0000EE;
    text-decoration: none;
    &:hover {
        text-decoration: underline;
    }
`
