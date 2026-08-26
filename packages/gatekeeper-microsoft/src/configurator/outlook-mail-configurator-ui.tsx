import {
  Autocomplete,
  Field,
  h,
  RadioCards,
  Section,
  type ConfiguratorUISpec,
} from "@gadgets/configurator-ui";
import type {
  OutlookMailConfiguratorRpc,
  OutlookMailConfiguratorValues,
} from "./outlook-mail-configurator-types";

export default {
  initial: { mode: "mailbox" },

  isReady({ values }) {
    return values.mode !== "folder" ||
      (typeof values.folder === "string" && values.folder.length > 0);
  },

  initialValuesFromResourceUrl({ resourceUrl }) {
    const url = new URL(resourceUrl);
    const hash = url.hash.replace(/^#/, "");
    if (hash.startsWith("folder/")) {
      return { mode: "folder", folder: decodeURIComponent(hash.slice("folder/".length)) };
    }
    return { mode: "mailbox" };
  },

  resourceUrl({ values }) {
    if (values.mode === "folder") {
      return `https://outlook.office.com/mail/#folder/${encodeURIComponent(values.folder ?? "")}`;
    }
    return "https://outlook.office.com/mail/";
  },

  render({ values, setValues, clearFields, ui }) {
    const mode = values.mode === "folder" ? "folder" : "mailbox";
    return <Section>
      <Field
        label="Mailbox scope"
        description="Choose whether this connection can access your whole Outlook mailbox or one top-level folder."
      >
        <RadioCards
          value={mode}
          options={[
            {
              value: "mailbox",
              title: "Whole mailbox",
              description: "Allow access to messages in every folder you can access.",
            },
            {
              value: "folder",
              title: "One folder",
              description: "Limit access to a single top-level Outlook folder.",
            },
          ]}
          onChange={nextMode => {
            if (nextMode !== "mailbox" && nextMode !== "folder") return;
            clearFields("folder");
            setValues({ mode: nextMode, folder: null });
          }}
        />
      </Field>

      {mode === "folder" && <Field
        label="Folder"
        description="Search the top-level folders in your mailbox."
      >
        <Autocomplete
          name="folder"
          value={values.folder}
          placeholder="Search folders..."
          loadOptions={query => ui.listFolders(query)}
          onChange={folder => setValues({ folder })}
        />
      </Field>}
    </Section>;
  },
} satisfies ConfiguratorUISpec<OutlookMailConfiguratorRpc, OutlookMailConfiguratorValues>;
