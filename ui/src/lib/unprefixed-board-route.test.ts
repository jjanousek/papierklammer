import { describe, expect, it } from "vitest";
import {
  findCompanyForIssuePathId,
  resolveUnprefixedBoardTargetCompany,
} from "./unprefixed-board-route";

const companies = [
  { id: "company-a", issuePrefix: "STA" },
  { id: "company-b", issuePrefix: "STAA" },
];

describe("findCompanyForIssuePathId", () => {
  it("matches an issue identifier to the correct company prefix", () => {
    expect(
      findCompanyForIssuePathId({
        companies,
        issueId: "STAA-1",
      }),
    ).toEqual(companies[1]);
  });

  it("ignores UUID-style issue ids", () => {
    expect(
      findCompanyForIssuePathId({
        companies,
        issueId: "5987492a-ac80-4f24-8e35-db99d0c6d69b",
      }),
    ).toBeNull();
  });
});

describe("resolveUnprefixedBoardTargetCompany", () => {
  it("prefers the company encoded in an unprefixed issue identifier", () => {
    expect(
      resolveUnprefixedBoardTargetCompany({
        companies,
        selectedCompanyId: "company-a",
        routeIssueId: "STAA-1",
      }),
    ).toEqual(companies[1]);
  });

  it("falls back to the resolved issue company for UUID deep links", () => {
    expect(
      resolveUnprefixedBoardTargetCompany({
        companies,
        selectedCompanyId: "company-a",
        routeIssueId: "5987492a-ac80-4f24-8e35-db99d0c6d69b",
        issueCompanyId: "company-b",
      }),
    ).toEqual(companies[1]);
  });

  it("falls back to the selected company when no issue-specific company is available", () => {
    expect(
      resolveUnprefixedBoardTargetCompany({
        companies,
        selectedCompanyId: "company-a",
      }),
    ).toEqual(companies[0]);
  });
});
