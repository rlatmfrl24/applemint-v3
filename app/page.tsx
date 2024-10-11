import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import AuthButton from "../components/AuthButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewThreads } from "./new-threads/main";
import { ThreadsSelector } from "./new-threads/threads-selector";

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

      <div className="flex-1 flex flex-col container p-3">
        <Tabs defaultValue="new" className="flex-auto h-0 flex flex-col">
          <div className="flex sm:items-center gap-4 sm:flex-row flex-col">
            <TabsList className="w-fit">
              <TabsTrigger value="new">New Threads</TabsTrigger>
              <TabsTrigger value="quick">Quick List</TabsTrigger>
              <TabsTrigger value="trash">Trash</TabsTrigger>
            </TabsList>
            <ThreadsSelector />
          </div>
          <TabsContent value="new" className="flex-auto h-0">
            <NewThreads />
          </TabsContent>
          <TabsContent value="quick">
            <h2>Quick List</h2>
          </TabsContent>
          <TabsContent value="trash">
            <h2>Trash</h2>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
