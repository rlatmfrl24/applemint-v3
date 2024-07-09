import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import AuthButton from "../components/AuthButton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function Index() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/login");
  }

  return (
    <div className="flex-1 w-full flex flex-col items-center">
      <nav className="w-full flex justify-center border-b border-b-foreground/10">
        <div className="w-full container flex justify-between items-center p-3 gap-2">
          <h1>Applemint</h1>
          <AuthButton />
        </div>
      </nav>

      <div className="flex-1 flex flex-col container px-3 border m-3 p-3 rounded-xl">
        <Tabs defaultValue="new">
          <TabsList>
            <TabsTrigger value="new">New Threads</TabsTrigger>
            <TabsTrigger value="quick">Quick List</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
