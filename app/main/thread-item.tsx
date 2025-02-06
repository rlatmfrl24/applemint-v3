import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ThreadItemType } from "@/lib/typeDefs";
import { createClient } from "@/utils/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCallback, useEffect, useState } from "react";

export const DefaultThreadItem = ({
  thread,
  threadName,
  extraButtons,
  disablePrimaryAction,
}: {
  thread: ThreadItemType;
  threadName: string;
  extraButtons?: React.ReactNode;
  disablePrimaryAction?: boolean;
}) => {
  const queryClient = useQueryClient();

  const removeThread = useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error: DeleteError } = await supabase
        .from(threadName)
        .delete()
        .eq("id", parseInt(id));
      if (DeleteError) {
        console.error("🚀 ~ removeThread ~ error", DeleteError);
        return;
      }

      const { error: TrashInsertError } = await supabase.from("trash").insert([
        {
          type: thread.type,
          url: thread.url,
          title: thread.title,
          description: thread.description,
          host: thread.host,
        },
      ]);

      if (TrashInsertError) {
        console.error("🚀 ~ removeThread ~ error", TrashInsertError);
        return;
      }
    },
    onSettled: async () => {
      return await queryClient.invalidateQueries({
        queryKey: [threadName],
      });
    },
  });

  return (
    <motion.div
      key={thread.id}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
    >
      <Card
        className="cursor-pointer max-w-full w-full
          hover:bg-zinc-200 dark:hover:bg-zinc-900
           transition-colors duration-200"
        onClick={() => {
          window.open(thread.url, "_blank");
        }}
      >
        <CardHeader className="max-w-full">
          <CardTitle className="max-w-full w-full text-ellipsis overflow-hidden">
            {thread.title}
          </CardTitle>
          <CardDescription className="max-w-full w-full text-ellipsis overflow-hidden">
            {thread.url}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-2 items-center justify-between">
          {disablePrimaryAction ? null : (
            <Button
              size={`sm`}
              disabled={removeThread.isPending}
              onClick={async (e) => {
                e.stopPropagation();
                removeThread.mutate(thread.id);
              }}
            >
              {!removeThread.isPending ? (
                "Delete"
              ) : (
                <Loader2 className="animate-spin" />
              )}
            </Button>
          )}
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {extraButtons}
            {!disablePrimaryAction && <RaindropSheet thread={thread} />}
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
};

const formSchema = z.object({
  title: z.string(),
  description: z.string(),
  collection: z.nullable(z.object({ id: z.string(), title: z.string() })),
  url: z.string().url(),
  tags: z.array(z.string()),
});

const RaindropSheet = ({ thread }: { thread: ThreadItemType }) => {
  const queryClient = useQueryClient();

  const [selectedCollection, setSelectedCollection] = useState<{
    id: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    console.log("🚀 ~ selectedCollection", selectedCollection);
  }, [selectedCollection]);

  const fetchCollections = async () => {
    console.log("fetching collections");
    try {
      const response = await fetch("/api/raindrop/collection");
      const data = await response.json();
      queryClient.invalidateQueries({
        queryKey: ["raindrop-tags"],
      });
      return data as { id: string; title: string; count: number }[];
    } catch (error) {
      console.error("Error fetching collections:", error);
      return [];
    }
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: thread.title,
      description: thread.description,
      collection: null,
      url: thread.url,
      tags: [],
    },
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    console.log("🚀 ~ data", data);
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size={`sm`} variant={`ghost`}>
          Go to Raindrop
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add Raindrop</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>URL</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="collection"
              render={({ field }) => {
                const {
                  data: collections,
                  isLoading,
                  error,
                } = useQuery({
                  queryKey: ["raindrop-collections"],
                  queryFn: fetchCollections,
                });

                return (
                  <FormItem>
                    <FormLabel>Collection</FormLabel>
                    <Select
                      onValueChange={(value) => {
                        form.setValue(
                          "collection",
                          collections?.find((c) => c.title === value) ?? null
                        );
                        setSelectedCollection(
                          collections?.find((c) => c.title === value) ?? null
                        );
                      }}
                      defaultValue={field.value?.title}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select Collection" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {collections?.map((collection, index) => (
                            <SelectItem key={index} value={collection.title}>
                              {collection.title}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormItem>
                );
              }}
            />
            {form.getValues().collection && (
              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => {
                  //TODO: make fetchTags function

                  return (
                    <FormItem>
                      <FormLabel>Tags</FormLabel>
                      <Input
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (e.currentTarget.value === "") return;
                            if (
                              form
                                .getValues()
                                .tags.includes(e.currentTarget.value)
                            )
                              return;

                            form.setValue("tags", [
                              ...form.getValues().tags,
                              e.currentTarget.value,
                            ]);
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                      <div className="flex gap-2 flex-wrap">
                        {form.getValues().tags.map((tag, index) => (
                          <Badge
                            key={index}
                            className="cursor-pointer select-none"
                            onClick={() => {
                              form.setValue(
                                "tags",
                                form.getValues().tags.filter((t) => t !== tag)
                              );
                            }}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </FormItem>
                  );
                }}
              />
            )}
            <Button type="submit">Save</Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
};
