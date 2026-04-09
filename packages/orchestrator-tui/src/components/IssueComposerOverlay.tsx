import React, { useEffect, useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

const PRIORITIES = ["critical", "high", "medium", "low"] as const;

export interface IssueComposerValues {
  title: string;
  description: string;
  priority: (typeof PRIORITIES)[number];
}

export interface IssueComposerOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (values: IssueComposerValues) => Promise<void>;
}

export function IssueComposerOverlay({
  visible,
  onDismiss,
  onSubmit,
}: IssueComposerOverlayProps): React.ReactElement | null {
  const [step, setStep] = useState<"title" | "description">("title");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priorityIndex, setPriorityIndex] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setStep("title");
    setTitle("");
    setDescription("");
    setPriorityIndex(1);
    setSubmitting(false);
    setError(null);
  }, [visible]);

  const submit = useCallback(async () => {
    if (!title.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        priority: PRIORITIES[priorityIndex] ?? "high",
      });
      onDismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setSubmitting(false);
    }
  }, [description, onDismiss, onSubmit, priorityIndex, submitting, title]);

  useInput(
    (input, key) => {
      if (!visible) {
        return;
      }
      if (key.escape) {
        onDismiss();
        return;
      }
      if (key.tab) {
        setStep((current) => (current === "title" ? "description" : "title"));
        return;
      }
      if (input === "p") {
        setPriorityIndex((current) => (current + 1) % PRIORITIES.length);
      }
    },
    { isActive: visible },
  );

  if (!visible) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      alignSelf="center"
      width="80%"
    >
      <Text bold color="cyan">
        New Issue
      </Text>
      <Text dimColor>
        Title first, then a short description. Press p to cycle priority.
      </Text>
      <Text> </Text>
      <Text bold color="yellow">
        Title
      </Text>
      <TextInput
        value={title}
        onChange={setTitle}
        focus={step === "title" && !submitting}
        placeholder="What needs to happen?"
        onSubmit={() => {
          if (step === "title") {
            setStep("description");
          }
        }}
      />
      <Text> </Text>
      <Text bold color="yellow">
        Description
      </Text>
      <TextInput
        value={description}
        onChange={setDescription}
        focus={step === "description" && !submitting}
        placeholder="Why this matters / next constraint"
        onSubmit={() => {
          void submit();
        }}
      />
      <Text> </Text>
      <Text>
        Priority: <Text color="yellow">{PRIORITIES[priorityIndex]}</Text>
      </Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>
        Enter advances or submits · Tab switches field · Esc closes
      </Text>
      {submitting ? <Text color="yellow">Creating issue…</Text> : null}
    </Box>
  );
}
