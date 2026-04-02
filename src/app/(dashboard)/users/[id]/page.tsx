"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { UserDetail } from "@/components/users/user-detail";

interface UserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function UserDetailPage({ params }: UserDetailPageProps) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "info";

  return (
    <div className="p-6">
      <UserDetail userId={id} initialTab={tab} />
    </div>
  );
}
