interface DetailedTaskLog {
  test_case_id: string;
  description: string;
  command: string;
  result_id: number;
  time_ms: number;
  memory_kb: number;
  exit_code: number;
  expected_exit_code: number;
  ignore_exit: boolean;
  stdin: string | null;
  stdout: string;
  stderr: string;
  expected_stdout: string | null;
  expected_stderr: string | null;
}

export type { DetailedTaskLog };
