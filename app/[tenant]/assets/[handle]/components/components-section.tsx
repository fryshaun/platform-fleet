import { Trash2Icon, Undo2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteComponent, removeComponent } from "@/lib/actions/asset-components";
import type { Asset } from "@/lib/assets";
import {
  type AssetComponent,
  type ComponentKind,
  componentWhereLabel,
  fittedWindowLabel,
  isFitted,
} from "@/lib/components";

import { ComponentFields } from "./component-fields";

/**
 * The parts on one unit, each row a form.
 *
 * A part has no page of its own either — it is a name, a serial, a kind and a
 * window — so the same arrangement as the kinds deck: a card per component whose
 * body is the edit form. What differs is the two buttons under it, and they are
 * the point of the tab:
 *
 *   - **Remove** posts `removed_on` (today) through `removeComponent`. The row
 *     stays, because the service history hangs off it; only the fitting ends.
 *   - **Delete** is manager work and is the honest way to undo a misfiled part.
 *
 * Both live on the same `<form>` as the fields and are posted with `formAction`,
 * so a row of fields and up to two buttons needs no nested forms.
 */
export function ComponentsSection({
  slug,
  asset,
  components,
  kinds,
  canEdit,
  canDelete,
}: {
  slug: string;
  asset: Asset;
  /** Every component filed against this unit, fitted ones first. */
  components: readonly AssetComponent[];
  kinds: readonly ComponentKind[];
  /** The caller may fit and remove parts — front desk and up, when writable. */
  canEdit: boolean;
  /** The caller may delete a part outright — manager and up. */
  canDelete: boolean;
}) {
  const kindNames = new Map(kinds.map((kind) => [kind.id, kind.name]));

  return (
    <ul className="space-y-4">
      {components.map((component) => {
        const kindName = component.kind_id
          ? (kindNames.get(component.kind_id) ?? "Kind removed")
          : "No kind";
        const fitted = isFitted(component);

        return (
          <li key={component.id}>
            <article
              aria-label={component.name}
              className="bg-card text-card-foreground focus-within:ring-ring/50 flex flex-col gap-3 rounded-xl border p-4 shadow-sm focus-within:ring-[3px]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{component.name}</p>
                <p className="text-muted-foreground text-xs">
                  {kindName} · {componentWhereLabel(component, asset.name)} ·{" "}
                  {fittedWindowLabel(component)}
                </p>
              </div>

              {canEdit ? (
                <ComponentFields
                  slug={slug}
                  asset={asset}
                  kinds={kinds}
                  component={component}
                  formId={`component-${component.id}`}
                  submitLabel="Save"
                  actions={
                    <>
                      {fitted ? (
                        <Button
                          type="submit"
                          formAction={removeComponent}
                          formNoValidate
                          size="sm"
                          variant="ghost"
                        >
                          <Undo2Icon aria-hidden="true" />
                          Remove
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          type="submit"
                          formAction={deleteComponent}
                          formNoValidate
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${component.name}`}
                        >
                          <Trash2Icon aria-hidden="true" />
                          Delete
                        </Button>
                      ) : null}
                    </>
                  }
                />
              ) : (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {component.serial ? (
                    <div>
                      <dt className="text-muted-foreground text-xs">
                        Serial number
                      </dt>
                      <dd className="font-mono">{component.serial}</dd>
                    </div>
                  ) : null}
                  {component.notes ? (
                    <div>
                      <dt className="text-muted-foreground text-xs">Notes</dt>
                      <dd>{component.notes}</dd>
                    </div>
                  ) : null}
                </dl>
              )}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
