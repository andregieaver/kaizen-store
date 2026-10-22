import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { RequestSkeleton } from "@/components/admin/privacy/skeletons";
import { RequestDetail } from "@/components/admin/privacy/request-detail";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { exportProblemOf } from "@/lib/privacy-admin";
import { memberCan, requirePermission } from "@/server/permissions";
import { requestSubject } from "@/server/privacy-pages";
import { getRequest } from "@/server/privacy-requests";

import { cancelRequestAction, closeNoDataAction, extendRequestAction, identityDoubtAction, refuseRequestAction } from "../actions";

export const metadata: Metadata = { title: "Privacy request" };

/** One privacy request (wave 1, 1g, D162): the person, the clock, and what staff may do while it is open. */
export default async function PrivacyRequestPage({ params, searchParams }: PageProps<"/admin/[store]/privacy/[requestId]">) {
  const { store: slug, requestId } = await params;
  const member = await requirePermission(slug, "customers:read");
  if (!z.uuid().safeParse(requestId).success) notFound();
  return (
    <Suspense fallback={<RequestSkeleton />}>
      <Request storeSlug={member.store.slug} requestId={requestId} searchParams={searchParams} />
    </Suspense>
  );
}

async function Request({
  storeSlug,
  requestId,
  searchParams,
}: {
  storeSlug: string;
  requestId: string;
  searchParams: PageProps<"/admin/[store]/privacy/[requestId]">["searchParams"];
}) {
  const member = await requirePermission(storeSlug, "customers:read");
  const request = await getRequest(member.store.id, requestId);
  if (!request) notFound();
  const exportParam = (await searchParams).export;
  const open = request.status === "open";
  const subject = open ? await requestSubject(member.store.id, request) : { key: null, holdsData: false };
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "privacy");
  const problem = exportProblemOf(Array.isArray(exportParam) ? exportParam[0] : exportParam);
  return (
    <AdminTextScope texts={adminTexts(lang, ["privacy"])}>
      <RequestDetail
        base={`/admin/${member.store.slug}`}
        request={request}
        canWrite={memberCan(member, "customers:write")}
        timeZone={member.store.timeZone}
        problem={problem ? (words.problems[problem] ?? problem) : null}
        words={words}
        locale={ADMIN_LANG_FACTS[lang].locale}
        subjectKey={subject.key}
        holdsData={subject.holdsData}
        actions={{
          extend: extendRequestAction.bind(null, storeSlug, requestId),
          refuse: refuseRequestAction.bind(null, storeSlug, requestId),
          closeNoData: closeNoDataAction.bind(null, storeSlug, requestId),
          cancel: cancelRequestAction.bind(null, storeSlug, requestId),
          identity: identityDoubtAction.bind(null, storeSlug, requestId),
        }}
      />
    </AdminTextScope>
  );
}
