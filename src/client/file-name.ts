/** Decode the filename carried in a resource address for both tab and editor titles. */
export function basenameOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  try {
    return decodeURIComponent(name)
  } catch {
    // A malformed percent sequence is still a name; showing it raw beats refusing the address.
    return name
  }
}
