import {
  formatDateTimeInTimeZone,
  formatShortDayInTimeZone,
  type IssuedDocumentKind,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FileCheck2 } from "lucide-react";

import { SectionCard, SectionLink } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import {
  listChecklistReports,
  loadDocumentEmailStates,
} from "../../../lib/contracts/document-emails";
import { listIssuedDocuments } from "../../../lib/contracts/issued-documents";
import { rentalDocumentPath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { IssuedPaper } from "./issued-paper";
import { RENTAL_TAB_LINKS } from "./rental-tabs";

/** The papers signed for a rental; its invoices and receipts are on the Money tab. */
const SIGNED_PAPER_KINDS = [
  "contract",
  "handover_report",
  "return_report",
  "change_of_terms",
  "swap_form",
] as const satisfies readonly IssuedDocumentKind[];
type SignedPaperKind = (typeof SIGNED_PAPER_KINDS)[number];

/** What each paper is called, and its button's words (as the cards said before the tabs). */
const PAPER_WORDING: Readonly<Record<SignedPaperKind, { title: string; open: string }>> = {
  contract: { title: "Contract", open: "Open signed contract" },
  handover_report: { title: "Handover report", open: "Open handover report" },
  return_report: { title: "Return report", open: "Open return report" },
  change_of_terms: { title: "Change of terms", open: "Open signed form" },
  swap_form: { title: "Car swap form", open: "Open swap form" },
};
/** A car swap's own pair of reports, told apart from the rental's first handover and last return. */
const SWAP_REPORT_WORDING: Readonly<
  Record<"handover_report" | "return_report", { title: string; open: string }>
> = {
  handover_report: { title: "Swap: handover report", open: "Open swap handover report" },
  return_report: { title: "Swap: return report", open: "Open swap return report" },
};

export interface RentalPaper {
  documentId: string;
  kind: SignedPaperKind;
  issuedAt: Date;
  title: string;
  openLabel: string;
}

function isSignedPaperKind(kind: IssuedDocumentKind): kind is SignedPaperKind {
  return (SIGNED_PAPER_KINDS as readonly string[]).includes(kind);
}

/** The rental's signed papers, oldest first: the contract, then reports and changes as they came. */
export async function loadRentalPapers(
  rentalId: string,
  user: SignedInUser,
): Promise<RentalPaper[]> {
  const [documents, reports] = await Promise.all([
    listIssuedDocuments(appDb, user.operatorId, rentalId),
    listChecklistReports(appDb, user.operatorId, rentalId),
  ]);
  const swapReportIds = new Set(
    reports.filter((report) => report.isForSwap).map((report) => report.documentId),
  );
  return documents
    .flatMap((document) => {
      const { kind } = document;
      if (!isSignedPaperKind(kind)) {
        return [];
      }
      const wording =
        (kind === "handover_report" || kind === "return_report") && swapReportIds.has(document.id)
          ? SWAP_REPORT_WORDING[kind]
          : PAPER_WORDING[kind];
      return [
        {
          documentId: document.id,
          kind,
          issuedAt: document.issuedAt,
          title: wording.title,
          openLabel: wording.open,
        },
      ];
    })
    .reverse();
}

/** Whether the rental's contract has been signed, and when. */
export function signedContractOf(papers: readonly RentalPaper[]): RentalPaper | undefined {
  return papers.find((paper) => paper.kind === "contract");
}

const ROW_CLASSES = "flex flex-col gap-2 border-t py-3";

/** A paper still to come, so the Operator knows where it will be. */
function PaperToCome({ title, text }: { title: string; text: string }) {
  return (
    <li className={ROW_CLASSES}>
      <p className="font-bold">{title}</p>
      <p className="text-muted-foreground text-sm">{text}</p>
    </li>
  );
}

/** The reports and changes still to come, for where the rental is. */
function papersToCome(rental: RentalDetail, papers: readonly RentalPaper[]) {
  const has = (kind: SignedPaperKind) => papers.some((paper) => paper.kind === kind);
  return [
    !has("handover_report") && (rental.status === "draft" || rental.status === "booked")
      ? { title: "Handover report", text: "Made when the car is handed over." }
      : null,
    !has("return_report") && rental.status === "active"
      ? { title: "Return report", text: "Made when the car comes back." }
      : null,
    !has("change_of_terms") && !has("swap_form") && rental.status !== "cancelled"
      ? {
          title: "Changes",
          text: "None yet. A signed change shows here, such as new rent or a car swap.",
        }
      : null,
  ].filter((paper) => paper !== null);
}

/**
 * The Papers tab's list: every paper signed for the rental, each opening
 * its own PDF by its ID, with whether its copies went and Email again
 * (review G9-5, G9-9). The contract still to sign is on its own card above.
 */
export async function PapersCard(props: {
  rental: RentalDetail;
  user: SignedInUser;
  papers: readonly RentalPaper[];
}) {
  const { rental, user, papers } = props;
  const emails = await loadDocumentEmailStates(
    appDb,
    user.operatorId,
    papers.map((paper) => paper.documentId),
  );
  return (
    <SectionCard heading="Signed papers">
      <ul aria-label="Signed papers">
        {papers.map((paper) => (
          <li key={paper.documentId} className={ROW_CLASSES}>
            <div>
              <p className="font-bold">{paper.title}</p>
              <p className="text-muted-foreground text-sm">
                Signed {formatDateTimeInTimeZone(paper.issuedAt, user.operatorTimezone)}. Fixed: it
                can never be changed.
              </p>
            </div>
            <IssuedPaper
              rentalId={rental.id}
              kind={paper.kind}
              documentId={paper.documentId}
              label={paper.openLabel}
              emails={emails}
            />
          </li>
        ))}
        {papersToCome(rental, papers).map((paper) => (
          <PaperToCome key={paper.title} title={paper.title} text={paper.text} />
        ))}
      </ul>
    </SectionCard>
  );
}

/** How many papers the Overview names; the Papers tab has them all. */
const PAPERS_SUMMARISED = 3;

/** On a computer's Overview: the newest papers, each a tap from its PDF, and All papers. */
export function PapersSummaryCard(props: {
  rentalId: string;
  papers: readonly RentalPaper[];
  timeZone: string;
  today: string;
}) {
  const newest = [...props.papers].reverse().slice(0, PAPERS_SUMMARISED);
  return (
    <SectionCard
      heading="Signed papers"
      aside={
        <SectionLink href={RENTAL_TAB_LINKS.href(props.rentalId, "papers")}>All papers</SectionLink>
      }
    >
      {newest.length === 0 ? (
        <p className="text-muted-foreground border-t py-3 text-sm">Nothing signed yet.</p>
      ) : (
        <ul aria-label="Newest signed papers">
          {newest.map((paper) => (
            <li key={paper.documentId} className="flex items-center gap-3 border-t py-2">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-bold">{paper.title}</span>
                <span className="text-muted-foreground">
                  , {formatShortDayInTimeZone(paper.issuedAt, props.timeZone, props.today)}
                </span>
              </p>
              <Button asChild variant="soft" size="sm" className="h-11">
                <a
                  href={rentalDocumentPath(props.rentalId, paper.kind, paper.documentId)}
                  target="_blank"
                  rel="noopener"
                  aria-label={`${paper.title} PDF`}
                >
                  <FileCheck2 aria-hidden />
                  PDF
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
