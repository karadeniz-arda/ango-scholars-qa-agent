export interface JiraIssue {
  key: string;
  summary: string;
}

export interface JiraFixture {
  issue: JiraIssue;
}