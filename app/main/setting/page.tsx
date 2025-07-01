"use client";

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

async function crawlerAPI(target: string) {
  const response = await fetch(`/api/crawl/manual?target=${target}`);
  const data = await response.json();
  return data;
}

export default function SettingPage() {
  const [result, setResult] = useState<string>("아직 크롤링 결과가 없습니다.");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const crawlerTrigger = (title: string, target: string) => {
    return (
      <AlertDialog>
        <AlertDialogTrigger className="w-full h-full" asChild>
          <Button className="w-full h-full">{title}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>
              서버 동작에 무리를 줄 수 있는 동작입니다.
              <br /> 만약 최근에 크롤링을 진행했다면 추가 크롤링을 진행하지
              않도록 주의해주세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setIsLoading(true);
                const result = await crawlerAPI(target);
                setResult(JSON.stringify(result));
                setIsLoading(false);
              }}
            >
              Crawl
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  return (
    <div className="flex flex-col flex-1 h-full w-full">
      <h2>Manual Crawling</h2>
      <div className="grid grid-cols-4 gap-2 mt-4">
        {crawlerTrigger("Crawl Arcalive", "arcalive")}
        {crawlerTrigger("Crawl Battlepage", "battlepage")}
        {crawlerTrigger("Crawl Insagirl", "insagirl")}
        {crawlerTrigger("Crawl IssueLink", "issuelink")}
      </div>
      <p className="mt-4">Crawl Result</p>
      <Textarea
        className="w-full"
        value={isLoading ? "Loading..." : result}
        disabled={isLoading}
        readOnly
      />
    </div>
  );
}
