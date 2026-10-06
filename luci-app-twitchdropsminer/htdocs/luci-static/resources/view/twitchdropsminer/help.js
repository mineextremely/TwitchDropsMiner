'use strict';
'require view';

/*
 * Mirrors the desktop GUI's "Help" tab. The section texts are reused verbatim
 * from the application's own translation catalogue (gui.help.* in
 * translate.py / lang/<name>.json) so the two UIs read identically, including
 * the numbered "Getting Started" list and its line breaks.
 *
 * The desktop tab also ends with an "Invalidate the authentication token"
 * button. It is deliberately absent here: revoking the token means POSTing to
 * id.twitch.tv/oauth2/revoke and deleting cookies.jar, which the browser cannot
 * do (CORS) and which needs a command channel into the miner process.
 */

function section(title, children) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
		E('div', { 'style': 'white-space: pre-wrap;' }, children)
	]);
}

function link(url, text) {
	return E('a', { 'href': url, 'target': '_blank', 'rel': 'noopener noreferrer' }, text);
}

return view.extend({
	render: function() {
		return E([], [
			E('h2', {}, _('Twitch Drops Miner')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('About')),
				E('p', {}, [
					_('Application created by:'), ' ',
					link('https://github.com/DevilXD', 'DevilXD')
				]),
				E('p', {}, [
					_('Repository:'), ' ',
					link('https://github.com/DevilXD/TwitchDropsMiner',
						'https://github.com/DevilXD/TwitchDropsMiner')
				]),
				E('p', {}, [
					_('Donate:'), ' ',
					link('https://www.buymeacoffee.com/DevilXD',
						_('If you like the application and found it useful, please consider donating a small amount of money to support me. Thank you!'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Useful Links')),
				E('p', {}, link('https://www.twitch.tv/drops/inventory',
					_('See Twitch inventory'))),
				E('p', {}, link('https://www.twitch.tv/drops/campaigns',
					_('See all campaigns and manage account links')))
			]),
			section(_('How It Works'),
				_('Every several seconds, the application pretends to watch a particular stream by fetching stream metadata - this is enough to advance the drops. Note that this completely bypasses the need to download any actual stream of video and sound. To keep the status (ONLINE or OFFLINE) of the channels up-to-date, there\'s a websocket connection established that receives events about streams going up or down, or updates regarding the current number of viewers.')),
			section(_('Getting Started'),
				_('1. Login to the application.\n2. Ensure your Twitch account is linked to all campaigns you\'re interested in mining.\n3. If you\'re interested in mining everything possible, change the Priority Mode to anything other than "Priority list only" and press on "Reload".\n4. If you want to mine specific games first, use the "Priority" list to set up an ordered list of games of your choice. Games from the top of the list will be attempted to be mined first, before the ones lower down the list.\n5. Keep the "Priority mode" selected as "Priority list only", to avoid mining games that are not on the priority list. Or not - it\'s up to you.\n6. Use the "Exclude" list to tell the application which games should never be mined.\n7. Changing the contents of either of the lists, or changing the "Priority mode", requires you to press on "Reload" for the changes to take an effect.'))
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
