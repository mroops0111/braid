import type { ViewFormDescriptor, ViewFormId } from '@braidhq/schema'

export function formOfId(
  forms: readonly ViewFormDescriptor[],
  id: ViewFormId,
): ViewFormDescriptor | undefined {
  return forms.find(form => form.id === id)
}

/**
 * What a form was actually asked for, with anything unsaid filled in.
 *
 * A reader may answer none of it, and usually does,
 * so every ask carries what is written when they say nothing.
 * A value nobody offered is dropped rather than passed on,
 * because a skill handed a choice outside its vocabulary,
 * has no way to tell that from one it has not implemented yet.
 */
export function askedOf(
  form: ViewFormDescriptor,
  given: Readonly<Record<string, string>>,
): Record<string, string> {
  const asked: Record<string, string> = {}
  for (const ask of form.asks) {
    const said = given[ask.id]
    const known = said !== undefined && ask.choices.some(choice => choice.id === said)
    asked[ask.id] = known ? said : ask.fallback
  }
  return asked
}

/**
 * What a form was asked for, as the one string a skill run is handed.
 *
 * A run takes a single argument, so the material and the request share it.
 * They are kept apart rather than merged,
 * because the material is a projection of the graph,
 * and comes out the same every time,
 * while the request is what this one reader wanted this once.
 */
export function argumentsFor(
  material: string,
  asked: Readonly<Record<string, string>>,
): string {
  return [material, ...Object.entries(asked).map(([key, value]) => `${key}=${value}`)].join(' ')
}

/** Which of a form's required settings this deployment left unset. */
export function unsetRequirements(
  form: ViewFormDescriptor,
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  // An empty value counts as unset,
  // since a variable exported as nothing is a reader who meant to set it,
  // and passing it on hands a skill a path to a directory that is not there.
  return form.requires.filter(name => (environment[name] ?? '') === '')
}
