"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";

async function crawlerAPI(target: string) {
  const response = await fetch(`/api/crawl/manual?target=${target}`);
  const data = await response.json();
  return data;
}

export default function SettingPage() {
  const [result, setResult] = useState<string>("아직 크롤링 결과가 없습니다.");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [bulkDeleteStatus, setBulkDeleteStatus] = useState<string>(
    "아직 일괄 삭제를 실행하지 않았습니다."
  );
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const supabase = createClient();

  const crawlerTrigger = (title: string, target: string) => {
    return (
      <AlertDialog>
        <AlertDialogTrigger className="h-full w-full" asChild>
          <Button className="h-full w-full">{title}</Button>
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

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      const { data: threads, error: selectError } = await supabase
        .from("new-threads")
        .select();

      if (selectError) {
        throw selectError;
      }

      const typedThreads = (threads ?? []) as ThreadItemType[];

      if (typedThreads.length > 0) {
        const { error: trashError } = await supabase.from("trash").insert(
          typedThreads.map((thread) => ({
            type: thread.type,
            url: thread.url,
            title: thread.title,
            description: thread.description,
            host: thread.host,
          }))
        );

        if (trashError) {
          throw trashError;
        }
      }

      const { error: deleteError } = await supabase
        .from("new-threads")
        .delete()
        .not("id", "is", null);

      if (deleteError) {
        throw deleteError;
      }

      setBulkDeleteStatus(
        `총 ${typedThreads.length}개의 스레드를 삭제했습니다.`
      );
    } catch (error) {
      console.error("신규 스레드 일괄 삭제 중 오류", error);
      if (error instanceof Error) {
        setBulkDeleteStatus(`삭제 실패: ${error.message}`);
      } else {
        setBulkDeleteStatus("삭제 실패: 알 수 없는 오류가 발생했습니다.");
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-1 flex-col">
      <h2>Manual Crawling</h2>
      <div className="mt-4 grid grid-cols-4 gap-2">
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
      <h2 className="mt-8">신규 스레드 관리</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        모든 신규 스레드를 휴지통으로 이동한 뒤 삭제합니다. 실행 전에 반드시
        확인해주세요.
      </p>
      <div className="mt-4 max-w-xs">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              className="w-full"
              variant="destructive"
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? "삭제 중..." : "신규 스레드 일괄 삭제"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>신규 스레드 일괄 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                모든 신규 스레드를 휴지통으로 이동한 뒤 삭제합니다.
                계속하시겠습니까?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isBulkDeleting}>
                취소
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isBulkDeleting}
                onClick={async () => {
                  await handleBulkDelete();
                }}
              >
                삭제 진행
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <Textarea
        className="mt-4 w-full"
        value={isBulkDeleting ? "삭제를 진행 중입니다..." : bulkDeleteStatus}
        disabled={isBulkDeleting}
        readOnly
      />
    </div>
  );
}
