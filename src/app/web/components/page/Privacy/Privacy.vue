<template lang="pug">
.singleplayer
  .container
    .column.col-12
      .panel-title
        h1 Are you soliciting my data bro?
        p This site does collect some aggregate information about visitors. This information is used
          |  to better understand what browser types are being used, areas of the world this site is being visited from,
          |  what monitor resolutions are being used - purely for development and debugging purposes (also some selfish curiosity of the site owner)

        p What we don't do is equally important

        ul
          li This site does not use tracking cookies
          li This site does not collect personally identifiable information
          li This site does not share or sell information to any third parties or any social media sites
          li This site does not participate in any cross-site tracking

        p We use an open source analytics tool to perform the numbers crunching for us
          | 
          a(href="https://plausible.io") plausible.io
          | 
          | which is an open source tool created by a privacy focused company. This is a paid for tool so there is
          | no incentive for mis-use of data.

        p This site is served over a TLS encrypted connection (See the lock icon in your browser) 
          |  so your quake-ing data will not be leaked.

        p All data added via the data add utility remains in your browser and is never sent to our servers.
        p For more information about how data is collected and stored, please visit 
          | 
          a(href="https://plausible.io/privacy-focused-web-analytics") plausible.io/privacy-focused-web-analytics

</template>

