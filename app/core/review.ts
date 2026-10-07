// Review gate and approval body structures
export const ReviewGate = {
  processing: new Set(["uploading", "transcribing", "extracting", "pending_transcript"]),

  status(memo: Record<string, any>): string {
    return String(memo["status"] ?? "").trim();
  },

  isReady(status: string): boolean {
    return status === "pending_review" || status === "approved";
  },

  failed(status: string): boolean {
    return status === "failed" || status === "rejected";
  },
};

export interface ExtractionPayload {
  summary: string;
  nextSteps: string[];
}

export interface ApproveBody {
  deal_id?: string;
  is_new_deal: boolean;
  extraction: ExtractionPayload;
  contact_id?: string;
  company_id?: string;
  skip_deal: boolean;
}

export function createApproveBody(
  summary: string,
  nextSteps: string[],
  dealId?: string,
  isNewDeal: boolean = false,
  contactId?: string,
  companyId?: string,
  skipDeal: boolean = false
): ApproveBody {
  const body: ApproveBody = {
    is_new_deal: isNewDeal,
    extraction: { summary, nextSteps },
    skip_deal: skipDeal,
  };
  if (dealId !== undefined) body.deal_id = dealId;
  if (contactId !== undefined) body.contact_id = contactId;
  if (companyId !== undefined) body.company_id = companyId;
  return body;
}
