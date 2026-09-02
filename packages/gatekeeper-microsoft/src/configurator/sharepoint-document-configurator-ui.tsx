import { Field, h, Section, TextInput, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type {
  SharePointDocumentConfiguratorRpc,
  SharePointDocumentConfiguratorValues,
} from "./sharepoint-document-configurator-types";

export default {
  initial: {},

  isReady({ values }) {
    if (!values.sharePointUrl) return false;
    try {
      return new URL(values.sharePointUrl).protocol === "https:";
    } catch {
      return false;
    }
  },

  initialValuesFromResourceUrl({ resourceUrl }) {
    return { sharePointUrl: resourceUrl };
  },

  async resourceUrl({ values, ui }) {
    if (!values.sharePointUrl) throw new Error("Paste a SharePoint file or folder URL.");
    return (await ui.resolveDocumentUrl(values.sharePointUrl)).resourceUrl;
  },

  render({ values, setValues }) {
    return <Section>
      <Field
        label="SharePoint file or folder URL"
        description="Paste a URL within the approved Digital Utilities SharePoint site. This connection can read only that file, or that folder and items beneath it."
      >
        <TextInput
          name="sharePointUrl"
          value={values.sharePointUrl}
          placeholder="https://knoxnswedu.sharepoint.com/sites/digital-utilities/..."
          onChange={sharePointUrl => setValues({ sharePointUrl })}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<
  SharePointDocumentConfiguratorRpc,
  SharePointDocumentConfiguratorValues
>;
