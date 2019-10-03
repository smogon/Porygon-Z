// Will Wrestle with global variables in NodeJS/Adding discord.js to here later
declare function toID(text: string): ID;
type ID = '' | string & {__isID: true};
type aliases = {[key: string]: string[]};
