import { describe, expect, it } from "vitest";
import {
  isOnboardingPath,
  resolveRouteOnboardingEntry,
  resolveRouteOnboardingOptions,
  shouldRedirectCompanylessRouteToOnboarding,
} from "./onboarding-route";

describe("isOnboardingPath", () => {
  it("matches the global onboarding route", () => {
    expect(isOnboardingPath("/onboarding")).toBe(true);
  });

  it("matches a company-prefixed onboarding route", () => {
    expect(isOnboardingPath("/pap/onboarding")).toBe(true);
  });

  it("ignores non-onboarding routes", () => {
    expect(isOnboardingPath("/pap/dashboard")).toBe(false);
  });
});

describe("resolveRouteOnboardingEntry", () => {
  it("treats an unknown prefixed onboarding route as invalid when another company exists", () => {
    expect(
      resolveRouteOnboardingEntry({
        pathname: "/nope/onboarding",
        companyPrefix: "nope",
        companies: [{ id: "company-1", issuePrefix: "PAP" }],
      }),
    ).toEqual({
      kind: "invalid_company_prefix",
      initialStep: 1,
      companyPrefix: "nope",
    });
  });

  it("falls back to global onboarding when no companies exist yet", () => {
    expect(
      resolveRouteOnboardingEntry({
        pathname: "/nope/onboarding",
        companyPrefix: "nope",
        companies: [],
      }),
    ).toEqual({
      kind: "global",
      initialStep: 1,
    });
  });
});

describe("resolveRouteOnboardingOptions", () => {
  it("opens company creation for the global onboarding route", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/onboarding",
        companies: [],
      }),
    ).toEqual({ initialStep: 1 });
  });

  it("opens agent creation when the prefixed company exists", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/pap/onboarding",
        companyPrefix: "pap",
        companies: [{ id: "company-1", issuePrefix: "PAP" }],
      }),
    ).toEqual({ initialStep: 1, companyId: "company-1" });
  });

  it("falls back to company creation when the prefixed company is missing", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/pap/onboarding",
        companyPrefix: "pap",
        companies: [],
      }),
    ).toEqual({ initialStep: 1 });
  });

  it("does not open onboarding for an invalid prefixed route when another company exists", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/nope/onboarding",
        companyPrefix: "nope",
        companies: [{ id: "company-1", issuePrefix: "PAP" }],
      }),
    ).toBeNull();
  });
});

describe("shouldRedirectCompanylessRouteToOnboarding", () => {
  it("redirects companyless entry routes into onboarding", () => {
    expect(
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: "/",
        hasCompanies: false,
      }),
    ).toBe(true);
  });

  it("does not redirect when already on onboarding", () => {
    expect(
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: "/onboarding",
        hasCompanies: false,
      }),
    ).toBe(false);
  });

  it("does not redirect when companies exist", () => {
    expect(
      shouldRedirectCompanylessRouteToOnboarding({
        pathname: "/issues",
        hasCompanies: true,
      }),
    ).toBe(false);
  });
});
