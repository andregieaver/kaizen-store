"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { CustomerChoiceList, type CustomerChoiceView } from "@/components/admin/customer-choices";
import { Button } from "@/components/admin/ui/button";
import { useFound } from "@/components/admin/use-found";
import { Field, TextInput } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";

/** A customer found for a task: their name and email only. */
export type TaskCustomerChoice = CustomerChoiceView;

/** The customer a task is about, as its editor shows them: their id and what they are called. */
export type TaskCustomerValue = { id: string; text: string };

/**
 * The customer a task is about (P4.7, Life's contact on an item): their name with a cross to take them off, or a field that finds one of the
 * store's customers by name or email from two letters typed. Drawn only for a person who may read customers, on a list that uses it.
 */
export function TaskCustomer({
  value,
  onChange,
  find,
  words: w,
  disabled,
}: {
  value: TaskCustomerValue | null;
  onChange: (value: TaskCustomerValue | null) => void;
  find: (query: string) => Promise<TaskCustomerChoice[]>;
  words: Pick<ProjectsMessages["item"], "customer" | "customerFind" | "customerNone" | "customerRemove">;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [shown, forget] = useFound(query, find);

  if (value)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{w.customer}</span>
        <span className="inline-flex w-fit max-w-full items-center gap-1 rounded-md border border-line bg-sunken py-1 pr-1 pl-3 text-body text-ink" data-task-customer>
          <span className="truncate">{value.text}</span>
          {!disabled && (
            <Button kind="icon" size="dense" aria-label={fillWords(w.customerRemove, { name: value.text })} onClick={() => onChange(null)}>
              <X />
            </Button>
          )}
        </span>
      </div>
    );

  return (
    <div className="flex flex-col gap-1.5">
      <Field label={w.customer}>
        {(control) => (
          <TextInput {...control} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={w.customerFind} autoComplete="off" disabled={disabled} full />
        )}
      </Field>
      {shown && (
        <CustomerChoiceList
          choices={shown}
          label={w.customerFind}
          none={w.customerNone}
          onChoose={(c) => {
            onChange({ id: c.id, text: c.name || c.email });
            setQuery("");
            forget();
          }}
        />
      )}
    </div>
  );
}
