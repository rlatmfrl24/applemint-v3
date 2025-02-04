import { Suspense } from "react";
import { NewThreads } from "./new-threads/main";

export default async function Index() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <div className="flex-1 w-full flex flex-col items-center container p-3">
        <NewThreads />
      </div>
    </Suspense>
  );
}
