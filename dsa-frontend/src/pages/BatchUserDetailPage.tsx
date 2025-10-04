import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchBatchSubmissionUserUploadedFile, fetchEvaluationStatus, fetchProblemDetail, fetchSubmissionFiles } from '../api/GetAPI';
import { useAuth } from '../context/AuthContext';
import useApiClient from '../hooks/useApiClient';
import { Problem, EvaluationStatus, TestCases } from '../types/Assignments';
import styled from 'styled-components';
import JudgeResultsViewer from '../components/JudgeResultsViewer';
import { FileRecord } from '../types/Assignments';
import CodeBlock from '../components/CodeBlock';
import OfflineFileDownloadButton from '../components/OfflineFileDownloadButton';
import LoadingComponent from '../components/LoadingComponent';
import StatusButton from '../components/StatusButtonComponent';

export type BatchUserDetailState = {
	openingData: string;
};

type ColumnDefinition = {
    key: string;
    label: string;
    id: number | null;
};

const baseColumns: ColumnDefinition[] = [
  { key: "status", label: "ステータス", id: null },
  { key: "report", label: "レポート", id: null },
];


const BatchUserDetailPage: React.FC<{ openingData: string }> = ({ openingData = "ステータス" }) => {
  const { batchId, userId } = useParams<{ batchId: string; userId: string }>();
  const { token } = useAuth();
  const { apiClient } = useApiClient();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [evaluationStatus, setEvaluationStatus] = useState<EvaluationStatus | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [testCaseId2TestCase, setTestCaseId2TestCase] = useState<Map<number, TestCases>>(new Map());
  const [columns, setColumns] = useState<ColumnDefinition[]>(baseColumns);
  const [showingData, setShowingData] = useState<string>(openingData);
  const [uploadedZipBlob, setUploadedZipBlob] = useState<Blob | null>(null);

  const [uploadedFiles, setUploadedFiles] = useState<FileRecord[]>([]);
  const [selectedUploadedFile, setSelectedUploadedFile] = useState<string>('');

  const [assignmentId2ArrangedFiles, setAssignmentId2ArrangedFiles] = useState<Map<number, FileRecord[]>>(new Map());
  const [assignmentId2ArrangedZipBlob, setAssignmentId2ArrangedZipBlob] = useState<Map<number, Blob>>(new Map());
  const [selectedArrangedFile, setSelectedArrangedFile] = useState<string>('');


  useEffect(() => {
    setIsLoading(true);
    const fetchData = async () => {
      if (!batchId || !userId) return;
      try {
        // 特定のバッチ採点の特定の学生の詳細を取得
        const evaluationStatus = await apiClient({ apiFunc: fetchEvaluationStatus, args: [parseInt(batchId), userId] });
        setEvaluationStatus(evaluationStatus);

        let problemsData: Problem[] = [];
        // 課題情報を取得
        for (const problem of evaluationStatus.lecture.problems){
          const problemDetail = await apiClient({ apiFunc: fetchProblemDetail, args: [problem.lecture_id, problem.assignment_id, true] });
          problemsData.push(problemDetail);
        }
        setProblems(problemsData);

        // 新しいカラムを設定
        const newColumns = baseColumns.concat(
          problemsData.map(problem => ({ 
            key: problem.assignment_id.toString(), 
            label: problem.title, 
            id: problem.assignment_id 
          }))
        );
        setColumns(newColumns);

        // openingDataに対応するカラムを探す
        const openingColumn = newColumns.find(column => column.label === openingData);
        if (openingColumn) {
          setSelectedId(openingColumn.id);
          console.log(openingColumn.id)
        }

        
        if (evaluationStatus.upload_file_exists) {
          // アップロードされたファイルを取得
          const {files: file_list, zipBlob: uploadedZipBlob} = await apiClient({ apiFunc: fetchBatchSubmissionUserUploadedFile, args: [parseInt(batchId), userId] });
          setUploadedFiles(file_list);
          setUploadedZipBlob(uploadedZipBlob);
        }

        for (const submission of evaluationStatus.submissions) {
          const { files: arrangedFiles, zipBlob: arrangedZipBlob } = await apiClient({ apiFunc: fetchSubmissionFiles, args: [submission.id, "arranged"] });
          setAssignmentId2ArrangedFiles(prev => {
            const newMap = new Map(prev);
            newMap.set(submission.assignment_id, arrangedFiles);
            return newMap;
          });
          setAssignmentId2ArrangedZipBlob(prev => {
            const newMap = new Map(prev);
            newMap.set(submission.assignment_id, arrangedZipBlob);
            return newMap;
          });
        }

        // テストケースを取得
        const testCaseId2TestCase = new Map<number, TestCases>();
        for (const problem of problemsData) {
          for (const test_case of problem.detail?.test_cases ?? []) {
            testCaseId2TestCase.set(test_case.id, test_case);
          }
        }
        setTestCaseId2TestCase(testCaseId2TestCase);
      } catch (error) {
        console.error("Error fetching data: ", error);
      } finally {
        if (problems.length > 0 && evaluationStatus?.submissions.length! > 0 && selectedId === null) {
          setSelectedId(0);
        }
        setIsLoading(false);
      }
    };
    fetchData();
  }, [token, batchId, userId]);

  if (isLoading) {
    return <LoadingComponent message="読み込み中..." />;
  }

  const getSubmissionStatus = (status: "submitted" | "delay" | "non-submitted" | null) => {
    switch (status) {
      case "submitted":
        return '提出済み';
      case "delay":
        return '遅延';
      case "non-submitted":
        return '未提出';
      default:
        return '不明';
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleUploadedFileSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedUploadedFile(event.target.value);
  };

  const handleArrangedFileSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedArrangedFile(event.target.value);
  };

  const getSelectedUploadedFileContent = () => {
    const file = uploadedFiles.find((file) => file.name === selectedUploadedFile);
    return file?.content as string;
  };

  const getSelectedArrangedFileContent = () => {
    if (selectedId === null) return '';
    const files = assignmentId2ArrangedFiles.get(selectedId);
    if (!files) return '';
    const file = files.find((file) => file.name === selectedArrangedFile);
    return file?.content as string;
  };

  const handleColumnClick = (columnKey: string) => {
    const column = columns.find(col => col.key === columnKey);
    if (column && column.label !== showingData) {
      setShowingData(column.label);
      setSelectedId(column.id);
      setSelectedArrangedFile('');
    }
  };

  const getStatusForColumn = (column: ColumnDefinition, evaluationStatus: EvaluationStatus | null) => {
    if (!evaluationStatus) return "non-submitted";
  
    if (column.key === "status") {
      return evaluationStatus.status || "non-submitted";
    }
  
    if (column.key === "report") {
      if (!evaluationStatus.report_exists) {
        return "未提出";
      }
      return evaluationStatus.status === "submitted" ? "提出" : "遅延";
    }
  
    const submission = evaluationStatus.submissions.find(
      sub => sub.assignment_id.toString() === column.key
    );
    return submission?.result || "non-submitted";
  };

  const handleUploadedZipDownload = () => {
    if (!uploadedZipBlob) return;
    const url = window.URL.createObjectURL(uploadedZipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "uploaded_files.zip";
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const handleArrangedZipDownload = () => {
    if (!selectedId) return;
    const zipBlob = assignmentId2ArrangedZipBlob.get(selectedId)
    if (!zipBlob) return;
    const url = window.URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    // ファイル名: ex{evaluation_status.lecture?.id}-{selectedId}-arranged.zip
    a.download = `ex${evaluationStatus?.lecture.id}-${selectedId}-arranged.zip`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  console.log(JSON.stringify(evaluationStatus))
  
  return (
    <PageContainer>
      <h1>採点履歴</h1>
      <h2 style={{margin: '5px 0 5px'}}>
        <LinkButton href={`/batch/result/${batchId}`}>
          {evaluationStatus?.lecture.title} (Batch ID: {batchId})
        </LinkButton>
        &nbsp;&gt;&nbsp; {evaluationStatus?.username}({evaluationStatus?.user_id}) &nbsp;&gt;&nbsp; {showingData}
      </h2>
      <div style={{ fontSize: '14px', color: '#808080' }}>提出: {evaluationStatus?.submit_date instanceof Date ? evaluationStatus?.submit_date.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\//g, '-') : new Date(evaluationStatus?.submit_date!).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\//g, '-')}</div>
      <Divider style={{ height: '3px', marginBottom: '20px', borderRadius: '2px' }} />
      <div>
        <HeaderContainer>
          {columns.map((column) => (
            <HeaderColumnContainer 
              key={column.key}
              onClick={() => handleColumnClick(column.key)}
              isActive={column.label === showingData}
            >
              <HeaderItem>
                {column.label}
              </HeaderItem>
            </HeaderColumnContainer>
          ))}
        </HeaderContainer>
        <ResultContainer>
          {columns.map(column=> (
            <ColumnContainer 
              key={column.key}
            >
              <ResultItem>
                <StatusButton status={getStatusForColumn(column, evaluationStatus)} isButton={true} onClick={() => handleColumnClick(column.key)}/>
              </ResultItem>
            </ColumnContainer>
          ))}
        </ResultContainer>
      </div>
      <TitleContainer>
        <h2>提出ファイル</h2>
        {uploadedZipBlob && <DownloadButton onClick={handleUploadedZipDownload}>一括ダウンロード</DownloadButton>}
      </TitleContainer>
      <h3>レポート</h3>
      <ul>
        {uploadedFiles.filter(file => file.content instanceof Blob).map(file => (
          <li key={file.name}>
            <OfflineFileDownloadButton file={file} />
          </li>
        ))}
      </ul>
      <h3>プログラム</h3>
      <Dropdown onChange={handleUploadedFileSelect} value={selectedUploadedFile}>
        <option value="">ファイルを選択</option>
        {uploadedFiles.filter(file => typeof file.content === 'string').map(file => (
          <option key={file.name} value={file.name}>{file.name}</option>
        ))}
      </Dropdown>
      {selectedUploadedFile && (
        <CodeBlock code={getSelectedUploadedFileContent()} fileName={selectedUploadedFile} />
      )}
      {selectedId !== null && (
        <ResultTable>
          <ResultHeader>
            <ResultHeaderCell key={"term"} align="term">{"項目"}</ResultHeaderCell>
            <ResultHeaderCell key={"result"} align="result">{"結果"}</ResultHeaderCell>
          </ResultHeader>
          {(() => {
            // 選択中の課題のテスト結果を表示する．
            const submission = evaluationStatus?.submissions.find(
              (s) => s.assignment_id === selectedId
            );

            if (!submission) {
              return (
                <ResultRow isExpanded={false} onClick={() => {}}>
                  <ResultCell align="term">データがありません</ResultCell>
                </ResultRow>
              );
            }

            return submission.judge_results.map(judge_result => (
              <React.Fragment key={judge_result.id}>
                <ResultRow 
                  isExpanded={expandedRows.has(judge_result.id)}
                  onClick={() => toggleExpand(judge_result.id)}
                >
                  <ResultCell align="term">
                    {testCaseId2TestCase.get(judge_result.testcase_id)?.description || ''}
                  </ResultCell>
                  <ResultCell align="result">
                    <StatusButton status={judge_result.result as any} isButton={false} />
                  </ResultCell>
                  <ExpandIcon isExpanded={expandedRows.has(judge_result.id)} />
                </ResultRow>
                {expandedRows.has(judge_result.id) && (
                  <ExpandedContent>
                    <JudgeResultsViewer 
                      result={judge_result} 
                      testCase={testCaseId2TestCase.get(judge_result.testcase_id)!} 
                    />
                  </ExpandedContent>
                )}
              </React.Fragment>
            ));
          })()}
        </ResultTable>
      )}
      {/* Arranged Files*/}
      {selectedId !== null && (
        <>
          <TitleContainer>
            <h3>用意されたファイル</h3>
            <DownloadButton onClick={handleArrangedZipDownload}>一括ダウンロード</DownloadButton>
          </TitleContainer>
          <Dropdown onChange={handleArrangedFileSelect} value={selectedArrangedFile}>
            <option value="">ファイルを選択</option>
            {assignmentId2ArrangedFiles.get(selectedId)?.map(file => (
              <option key={file.name} value={file.name}>{file.name}</option>
            ))}
          </Dropdown>
          {selectedArrangedFile && (
            <CodeBlock code={getSelectedArrangedFileContent()} fileName={selectedArrangedFile} />
          )}
        </>
      )}
      
    </PageContainer>
  );

};

export default BatchUserDetailPage;

const PageContainer = styled.div`
  padding-bottom: 100px;
`;

const Divider = styled.hr`
    border: none;
    height: 1px;
    background-color: #E0E0E0;
    margin: 0;
`;

const HeaderContainer = styled.div`
    display: flex;
    flex-direction: row;
    background-color: #B8B8B8;
    padding: 10px;
`;

const ResultContainer = styled.div`
    display: flex;
    flex-direction: row;
    padding: 10px;
    gap: 10px;
    background-color: #FFFFFF;
`;

const ColumnContainer = styled.div`
    flex: 1;
`;

// ヘッダー用の新しいColumnContainer
const HeaderColumnContainer = styled(ColumnContainer)<{ isActive: boolean }>`
    cursor: ${props => props.isActive ? 'default' : 'pointer'};
    height: 100%;
    margin: -10px -10px;  // HeaderContainerのパディングを打ち消す
    padding: 10px 10px;  // 同じ分のパディングを追加して見た目を維持
    background-color: ${props => props.isActive ? '#898989' : 'transparent'};
    &:hover {
        background-color: ${props => props.isActive ? '#898989' : '#898989'};
    }
`;

const HeaderItem = styled.div`
    font-size: 25px;
    font-family: Inter;
    font-weight: 600;
    color: #FFFFFF;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
`;

const ResultItem = styled.div`
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
`;

const LinkButton = styled.a`
    color: #0000EE;
    text-decoration: none;
    &:hover {
        text-decoration: underline;
    }
`
const Dropdown = styled.select`
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

const ResultTable = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  margin-top: 20px;
  border: 1px solid #E0E0E0;
  border-radius: 10px;
  overflow: hidden;
`;

const ResultHeader = styled.div`
  display: flex;
  background-color: #B8B8B8;
  color: #FFFFFF;
  font-weight: 600;
  // padding: 10px;
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
`;

const ResultHeaderCell = styled.div<{ align?: string }>`
  flex: ${props => props.align === 'term' ? '3' : '1'};
  font-size: 25px;
  font-family: Inter;
  padding: 10px;
  text-align: ${props => props.align === 'term' ? 'center' : 'center'};
  padding-right: ${props => props.align === 'result' ? '40px' : '10px'};
`;

const ResultRow = styled.div<{ isExpanded: boolean }>`
  display: flex;
  align-items: center;
  background-color: #FFFFFF;
  border-top: 1px solid #E0E0E0;
  cursor: pointer;
  padding: 10px;
  
  &:hover {
    background-color: #F5F5F5;
  }
`;

const ResultCell = styled.div<{ align?: string }>`
  flex: ${props => props.align === 'term' ? '3' : '1'};
  font-size: 20px;
  font-family: Inter;
  font-weight: 600;
  padding: 0px 10px;
  text-align: ${props => props.align === 'term' ? 'left' : 'center'};
  display: flex;
  align-items: center;
  justify-content: ${props => props.align === 'term' ? 'flex-start' : 'center'};
  padding-right: ${props => props.align === 'result' ? '0px' : '10px'};
  padding-left: ${props => props.align === 'term' ? '10px' : '0px'};
`;

const ExpandIcon = styled.span<{ isExpanded: boolean }>`
  position: relative;
  width: 20px;
  height: 20px;
  margin-left: auto;
  margin-right: 10px;
  transform: ${props => props.isExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};
  transform-origin: center 75%;
  transition: transform 0.3s ease;

  &::before,
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: 50%;
    height: 2px;
    background-color: #666;
    transition: transform 0.3s ease;
  }

  &::before {
    left: 0;
    transform: rotate(45deg);
    transform-origin: 100% 100%;
  }

  &::after {
    right: 0;
    transform: rotate(-45deg);
    transform-origin: 0 100%;
  }
`;

const ExpandedContent = styled.div`
  padding: 15px;
  background-color: #f9f9f9;
  border-top: 1px solid #E0E0E0;
`;

const TitleContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 15px;
`;

const DownloadButton = styled.button`
  background-color: #4CAF50;
  color: white;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;

  &:hover {
    background-color: #45a049;
  }

  &:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
  }
`;
