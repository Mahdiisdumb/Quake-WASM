import * as cmd from './cmd'
import * as cvar from './cvar'

export type MatchKind = 'cmd' | 'cvar' | 'alias' | 'arg'

export type Match = {
  name: string,
  kind: MatchKind,
  // Current value, cvar matches only.
  value?: string,
  // Registered default, set only on the row the edit line names exactly.
  def?: string,
  // Index of the typed token within the name; >0 marks a substring (non-prefix) match.
  at?: number
}

export type CompleteState = {
  matches: Match[],
  selected: number,
  // True once Tab (or an arrow) has started cycling the match list.
  active: boolean,
  // Edit line the current match set was built from; null forces a rebuild.
  editCache: string | null,
  // Edit line text ahead of the token being completed; match names replace only that token.
  prefix: string,
  // Token the matches were gathered from — the highlight span; unchanged while Tab rewrites the line.
  token: string
}

const initState = (): CompleteState => {
  return {
    matches: [],
    selected: -1,
    active: false,
    editCache: null,
    prefix: '',
    token: ''
  }
}

export let state: CompleteState = initState()

const noMatches: Match[] = []

// Argument completion providers keyed by command name, consulted once the edit line has a space.
const argumentProviders: Record<string, (argv: string[]) => Match[]> = {}

export const addArgumentProvider = function(name: string, provider: (argv: string[]) => Match[])
{
  argumentProviders[name] = provider;
};

const byName = function(a: Match, b: Match)
{
  if (a.name < b.name)
    return -1;
  if (a.name > b.name)
    return 1;
  return 0;
};

const gather = function(editLine: string): Match[]
{
  if (editLine.length === 0)
    return noMatches;

  var space = editLine.indexOf(' ');
  if (space >= 0)
  {
    var provider = argumentProviders[editLine.substring(0, space).toLowerCase()];
    if (provider == null)
      return noMatches;
    return provider(editLine.split(' '));
  }

  var partial = editLine.toLowerCase();
  var matches: Match[] = [];
  var subs: Match[] = [];
  var i, at;
  for (i = 0; i < cmd.state.functions.length; ++i)
  {
    var fn = cmd.state.functions[i];
    at = fn.name.toLowerCase().indexOf(partial);
    if (at === 0)
      matches[matches.length] = {name: fn.name, kind: 'cmd'};
    else if (at > 0)
      subs[subs.length] = {name: fn.name, kind: 'cmd', at: at};
  }
  for (i = 0; i < cvar.vars.length; ++i)
  {
    var v = cvar.vars[i];
    at = v.name.toLowerCase().indexOf(partial);
    if (at === 0)
    {
      if (v.name.length === partial.length)
        matches[matches.length] = {name: v.name, kind: 'cvar', value: v.string, def: v.defaultString};
      else
        matches[matches.length] = {name: v.name, kind: 'cvar', value: v.string};
    }
    else if (at > 0)
      subs[subs.length] = {name: v.name, kind: 'cvar', value: v.string, at: at};
  }
  for (i = 0; i < cmd.state.alias.length; ++i)
  {
    var al = cmd.state.alias[i];
    at = al.name.toLowerCase().indexOf(partial);
    if (at === 0)
      matches[matches.length] = {name: al.name, kind: 'alias'};
    else if (at > 0)
      subs[subs.length] = {name: al.name, kind: 'alias', at: at};
  }
  if ((matches.length === 0) && (subs.length === 0))
    return noMatches;
  matches.sort(byName);
  subs.sort(byName);
  for (i = 0; i < subs.length; ++i)
    matches[matches.length] = subs[i];
  return matches;
};

// Rebuilds the match set when the edit line changed, and resets any cycling state.
export const update = function(editLine: string)
{
  if (editLine === state.editCache)
    return;
  state.editCache = editLine;
  state.prefix = editLine.indexOf(' ') < 0 ? '' : editLine.substring(0, editLine.lastIndexOf(' ') + 1);
  state.token = editLine.substring(state.prefix.length);
  state.matches = gather(editLine);
  state.selected = -1;
  state.active = false;
};

// Keeps the current match set valid across a programmatic edit-line change (completion, cycling).
export const hold = function(editLine: string)
{
  state.editCache = editLine;
};

export const dismiss = function()
{
  state.active = false;
  state.selected = -1;
};

export const reset = function()
{
  state = initState();
};

// Edit line to accept the given match with, keeping any command word ahead of it.
export const lineFor = function(match: Match)
{
  return state.prefix + match.name;
};

// Edit line completed to the longest prefix shared by every prefix-anchored match, cased as in
// the first; when only substring matches remain it returns the edit line so Tab cycles instead.
export const commonPrefix = function()
{
  var prefix: string | null = null;
  var i, j;
  for (i = 0; i < state.matches.length; ++i)
  {
    var match = state.matches[i];
    if ((match.at != null) && (match.at > 0))
      continue;
    var name = match.name;
    if (prefix == null)
    {
      prefix = name;
      continue;
    }
    for (j = 0; (j < prefix.length) && (j < name.length); ++j)
    {
      if (prefix[j].toLowerCase() !== name[j].toLowerCase())
        break;
    }
    prefix = prefix.substring(0, j);
    if (prefix.length === 0)
      break;
  }
  if (prefix == null)
    return state.editCache != null ? state.editCache : '';
  return state.prefix + prefix;
};

// Activates the popup and steps the selection by dir, wrapping. Null when there is nothing to cycle.
export const cycle = function(dir: number)
{
  if (state.matches.length === 0)
    return null;
  state.active = true;
  if (state.selected < 0)
    state.selected = dir > 0 ? 0 : state.matches.length - 1;
  else
    state.selected = (state.selected + dir + state.matches.length) % state.matches.length;
  return state.matches[state.selected];
};

export const selection = function()
{
  if ((state.active !== true) || (state.selected < 0))
    return null;
  return state.matches[state.selected];
};
