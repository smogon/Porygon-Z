# Porygon-Z

The Bot for the [Official Smogon Discord](https://discord.gg/smogon).

# Setting up your Bot
## Prerequisites
To setup your bot, you will need:
 - A [discord account](https://discordapp.com/).
 - A discord server that you have `Manage Server` permissions on. You can also try [creating a discord server](https://support.discordapp.com/hc/en-us/articles/204849977-How-do-I-create-a-server).
 - A [discord application](https://discordapp.com/developers/applications/) for your bot. (Explained further below)
 - [NodeJS](https://nodejs.org/en/) version 10 or later.

## Creating up a discord application and your bot's account
Head over to the [discord developer portal's application page](https://discordapp.com/developers/applications/) and sign in if you haven't and either create a new application for your bot or select an existing one. The bot's name is not the applications name. You should now be in the general information tab for your application, note that you can see a clientid here. The application's clientid will be necessary for inviting your bot to a server later. Switch to the bot tab and create a bot, do note that you cannot destroy a discord bot once you create it. Now on the bot page, you should be able to name your bot and see its token. Your bot's token is basically its password so keep it safe, we will need it later.

## Adding your bot's account to a discord server
Once you have created your bot, you will need to add it to a server. You will need `Manage Server` permissions in the server you want to add the bot to. You can also create a new server if you want, check the prerequisites list for a link with instructions on that. Once you know what server you want to add the bot to, you need to create your invite link. Your invite link will be in the form of:
```
https://discordapp.com/oauth2/authorize?client_id=CLIENT_ID_HERE&scope=bot
```
where `CLIENT_ID_HERE` is your application's client id that can be found under the general information tab. You can also add a permissions flag to guarantee that the bot will have certian permissions after it joins the server. The form of an invite link with permissions is:
```
https://discordapp.com/oauth2/authorize?client_id=CLIENT_ID_HERE&scope=bot&permissions=INTEGER
```
Where `INTEGER` is a number that represents what permissions the bot has. There is a calculator for this on your application's bot page.

Once you have your invite link, follow it and authorize your bot to join the server in question and it should show up in the userlist.

## Installing and starting the bot itself
Now that your bot's account has been added to the server(s) you want it in, you need to setup the bot itself. First make sure you have [NodeJS](https://nodejs.org/en/) 10 or later installed. Next, clone the bot with git or download and unzip the bot's files. Once you have your files, create a file called `.env` in the root folder of your bot. `.env`'s contents should look like this:
```
TOKEN=BOT_TOKEN
ADMINS=SNOWFLAKE,SNOWFLAKE,...
PREFIX=!
PGHOST=localhost
PGPORT=5432
PGUSER=porygonz
PGPASSWORD=null
PGDATABASE=porygonz
```
- `BOT_TOKEN` is the token (your bot's "password") found on the bot tab of your application. 
- `OWNERS` is a comma serpated list of discord user snowflakes. You can get a user's snowflake by enabling developer mode in your discord account's user settings and then right clicking the user and selecting `Copy ID` from the dropdown. Owners will bypass all permission checks on all servers.
- `PREFIX` is the bot's command prefix.
- `PGHOST` is the postgresSQL server location.
- `PGPORT` is the port for the postgresSQL server.
- `PGUSER` is the postgresSQL server user account the bot will login to.
- `PGPASSWORD` is the password for the postgresSQL user account the bot is attempting to login to or `null` for no password.
- `PGDATABASE` is the postgresSQL database the bot will attempt to access.

After setting up your .env file run `npm i --production` to install dependencies (exclude the `--production` flag if you plan to contribute to Porygon-Z so that developer dependencies are installed too).
After that running `npm start` should start your bot up.

## License
[MIT](https://github.com/smogon/Porygon-Z/blob/master/LICENSE)
