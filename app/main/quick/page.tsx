import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { QuickThreadWrapper } from "./threads";

export default async function QuickPage() {
  return <QuickThreadWrapper />;
}
