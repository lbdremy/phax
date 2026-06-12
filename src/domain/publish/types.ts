export type PushStatus = "not_attempted" | "pushed" | "failed";
export type PrStatus = "not_attempted" | "created" | "exists" | "failed";
type ProviderId = "github";

export interface PublicationRecord {
  readonly enabled: boolean;
  readonly provider: ProviderId;
  readonly remote: string;
  readonly branch: string;
  readonly baseBranch?: string;
  readonly pushStatus: PushStatus;
  readonly prStatus: PrStatus;
  readonly pullRequestUrl?: string;
  readonly createdAt: string;
  readonly failureReason?: string;
}
