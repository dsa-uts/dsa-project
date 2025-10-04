// 授業エントリの型定義
export type Lecture = {
  id: number;
  title: string;
  start_date: Date;
  end_date: Date;

  problems: Problem[];
};

export type Problem = {
  lecture_id: number;
  assignment_id: number;
  title: string;
  timeMS: number;
  memoryMB: number;

  detail: ProblemDetail | null;
}

export type ProblemDetail = {
  description: string | null;

  executables: Executables[];
  required_files: RequiredFiles[];
  test_cases: TestCases[];
}

export type Executables = {
  eval: boolean;
  name: string;
}

export type RequiredFiles = {
  name: string;
}

// テストケースの型を定義
export type TestCases = {
  id: number;
  eval: boolean;
  type: "Built" | "Judge";
  score: number;
  title: string;
  description: string | null;
  command: string;
  args: string | null;
  stdin: string | null;
  stdout: string | null;
  stderr: string | null;
  exit_code: number;
};

export type BatchSubmission = {
  id: number;
  ts: Date;
  user_id: string;
  lecture_id: number;
  message: string | null;
  status: "queued" | "running" | "done";
  complete_judge: number | null;
  total_judge: number | null;

  evaluation_statuses: EvaluationStatus[];
}

export type BatchSubmissionItemForListView = {
  id: number;
  ts: Date;
  user_id: string;
  username: string;
  lecture_id: number;
  lecture_title: string;
  message: string | null;
  status: "queued" | "running" | "done";
  complete_judge: number | null;
  total_judge: number | null;

  evaluation_statuses: EvaluationStatus[];
}

export type BatchSubmissionItemsForListView = {
  items: BatchSubmissionItemForListView[];
  total_items: number;
  current_page: number;
  total_pages: number;
  page_size: number;
}

export type BatchSubmissionDetailItem = {
  id: number;
  ts: Date;
  user_id: string;
  username: string;
  lecture_id: number;
  lecture: Lecture;
  message: string | null;
  status: "queued" | "running" | "done";
  complete_judge: number | null;
  total_judge: number | null;
  evaluation_statuses: EvaluationStatus[];
}

export type SubmissionSummaryStatus = "AC" | // Accepted
                                    "WA" | // Wrong Answer 
                                    "TLE" | // Time Limit Exceed
                                    "MLE" | // Memory Limit Exceed
                                    "RE" | // Runtime Error
                                    "CE" | // Compile Error
                                    "OLE" | // Output Limit Exceed (8000 bytes)
                                    "IE" | // Internal Error (e.g., docker sandbox management)
                                    "FN"; // File Not found

export type SubmissionStatusQuery = "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "OLE" | "IE" | "FN" | "WJ";

export type EvaluationStatus = {
  id: number;
  batch_id: number;
  user_id: string;
  username: string;
  lecture_id: number;
  lecture: Lecture;
  status: "submitted" | "delay" | "non-submitted";
  result: SubmissionSummaryStatus | null;
  upload_file_exists: boolean;
  report_exists: boolean;
  submit_date: Date | null;

  submissions: Submission[];
}

export type Submission = {
  id: number;
  ts: Date;
  evaluation_status_id: number | null;
  user_id: string;
  lecture_id: number;
  assignment_id: number;
  eval: boolean;
  progress: "pending" | "queued" | "running" | "done";
  total_task: number;
  completed_task: number;
  result: SubmissionSummaryStatus | null;
  message: string | null;
  detail: string | null;
  score: number | null;
  timeMS: number | null;
  memoryKB: number | null;

  judge_results: JudgeResult[];
}

export type JudgeResult = {
  id: number;
  ts: Date;
  submission_id: number;
  testcase_id: number;
  result: SingleJudgeStatus;
  command: string;
  timeMS: number;
  memoryKB: number;
  exit_code: number;
  stdout: string;
  stderr: string;
}

export enum SingleJudgeStatus {
  AC = "AC", // Accepted
  WA = "WA", // Wrong Answer
  TLE = "TLE", // Time Limit Exceed
  MLE = "MLE", // Memory Limit Exceed
  RE = "RE", // Runtime Error
  CE = "CE", // Compile Error
  OLE = "OLE", // Output Limit Exceed (8000 bytes)
  IE = "IE" // Internal Error (e.g., docker sandbox management)
}

export type FileRecord = {
  name: string;
  content: string | Blob;
}

export type ProgressMessage = {
    status: string;
    message: string;
    progress_percentage: number;
    result?: { [key: string]: any }; 
};

