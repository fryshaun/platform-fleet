import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { updateEnabledSections } from "@/lib/actions/settings";
import { SECTION_OPTIONS } from "@/lib/features";

/**
 * The section checklist.
 *
 * Plain checkboxes in one form: submitting it sends the whole selection, so the
 * action can write the row as an absolute list instead of applying deltas to it.
 * The list itself comes from `lib/features.ts`, which is why adding a section
 * needs no change here.
 */
export function SectionsSection({
  slug,
  enabled,
}: {
  slug: string;
  enabled: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sections</CardTitle>
        <CardDescription>
          Optional parts of this workspace. Switching one off hides it from
          everyone — including the navigation — without deleting anything;
          switching it back on brings the same rows back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateEnabledSections} className="space-y-4">
          <input type="hidden" name="slug" value={slug} />

          <ul className="divide-border divide-y rounded-xl border">
            {SECTION_OPTIONS.map((section) => (
              <li key={section.value} className="flex items-start gap-3 px-4 py-3">
                <input
                  id={`section-${section.value}`}
                  name="section"
                  type="checkbox"
                  value={section.value}
                  defaultChecked={enabled.includes(section.value)}
                  className="accent-primary mt-1 size-4"
                />
                <div className="min-w-0 space-y-1">
                  <Label htmlFor={`section-${section.value}`}>
                    {section.label}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {section.description}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <Button type="submit">Save sections</Button>
        </form>
      </CardContent>
    </Card>
  );
}
