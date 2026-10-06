'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var STATUS_FILE = '/tmp/twitchdropsminer.status.json';
var LOG_FILE = '/tmp/twitchdropsminer.log';

/*
 * Themes disagree on the negative label class: footstrap has .label.danger,
 * the bootstrap family has .label.important instead. Both are applied - the
 * class a theme doesn't know is ignored, and where both exist the theme's own
 * definition wins (bootstrap's .danger is undefined, footstrap's is last).
 */
var LABEL_BAD = 'label danger important';

function readStatus() {
	return fs.read(STATUS_FILE).then(function(data) {
		try {
			return JSON.parse(data);
		}
		catch (e) {
			return null;
		}
	}).catch(function() {
		return null;
	});
}

function formatMinutes(minutes) {
	if (minutes == null || minutes < 0)
		return '-';

	var hours = Math.floor(minutes / 60), mins = minutes % 60;

	return hours > 0 ? '%dh %dm'.format(hours, mins) : '%dm'.format(mins);
}

function progressBar(fraction, text) {
	var percent = Math.round((fraction || 0) * 100);

	return E('div', { 'class': 'cbi-progressbar', 'title': text || '%d%%'.format(percent) },
		E('div', { 'style': 'width:%d%%'.format(percent) }));
}

return view.extend({
	load: function() {
		return Promise.resolve();
	},

	render: function() {
		var self = this;
		var statusEl = E('span', { 'class': 'label' }, _('Checking...'));
		var infoEl = E('div', {}, '-');
		var campaignEl = E('div', {}, '-');
		var dropEl = E('div', {}, '-');
		var wsEl = E('div', {}, '-');
		var channelsEl = E('div', {}, '-');
		var logEl = E('pre', {
			'style': 'max-height: 25em; overflow: auto; white-space: pre-wrap; margin: 0;'
		}, _('Loading...'));

		function refreshServiceStatus() {
			return fs.exec('/etc/init.d/twitchdropsminer', [ 'status' ]).then(function(res) {
				var running = (res.code === 0);

				statusEl.textContent = running ? _('Running') : _('Stopped');
				statusEl.className = running ? 'label success' : LABEL_BAD;
			}).catch(function() {
				statusEl.textContent = _('Stopped');
				statusEl.className = LABEL_BAD;
			});
		}

		function refreshLog() {
			return fs.read(LOG_FILE).then(function(data) {
				var lines = (data || '').trim().split('\n');

				logEl.textContent = lines.slice(-200).join('\n') || _('(empty)');
				logEl.scrollTop = logEl.scrollHeight;
			}).catch(function() {
				logEl.textContent = _('No log available yet.');
			});
		}

		function replace(node, children) {
			while (node.firstChild)
				node.removeChild(node.firstChild);
			for (var i = 0; i < children.length; i++)
				node.appendChild(children[i]);
		}

		function renderInfo(st) {
			if (st == null)
				return [ E('p', {}, _('No status available yet - the miner is not running.')) ];
			var auth = st.auth || {};

			var children = [
				E('p', {}, [
					_('State:'), ' ', E('strong', {}, st.state || '-'),
					(st.status ? [ ' • ', st.status ] : '')
				]),
				E('p', {}, [
					_('Login:'), ' ',
					auth.logged_in
						? E('span', { 'class': 'label success' },
							_('Logged in (user %d)').format(auth.user_id))
						: E('span', { 'class': LABEL_BAD }, _('Not logged in'))
				])
			];
			if (auth.device_code)
				children.push(E('p', {}, [
					_('Device code:'), ' ', E('strong', {}, auth.device_code.user_code), ' — ',
					E('a', { 'href': auth.device_code.verification_uri, 'target': '_blank' },
						auth.device_code.verification_uri)
				]));

			return children;
		}

		function renderCampaign(st) {
			var progress = st && st.progress;

			if (!progress)
				return [ E('p', {}, _('Not mining at the moment.')) ];

			var campaign = progress.campaign;
			var text = _('%d/%d drops claimed').format(
				campaign.claimed_drops, campaign.total_drops
			);

			return [
				E('p', {}, [ E('strong', {}, campaign.game || '?'), ' — ', campaign.name ]),
				progressBar(campaign.progress, '%d%%'.format(Math.round(campaign.progress * 100))),
				E('p', {}, [
					_('%d%% complete').format(Math.round(campaign.progress * 100)),
					' • ', text
				]),
				E('p', {}, [ _('%s remaining').format(formatMinutes(campaign.remaining_minutes)) ])
			];
		}

		function renderDrop(st) {
			var progress = st && st.progress;

			if (!progress)
				return [ E('p', {}, _('Not mining at the moment.')) ];

			var drop = progress.drop;
			/* NOTE: `rewards` is already a comma separated string (rewards_text()) */
			var children = [
				E('p', {}, [
					E('strong', {}, drop.name || '-'),
					(drop.rewards ? ' — ' + drop.rewards : '')
				]),
				progressBar(drop.progress, '%d%%'.format(Math.round(drop.progress * 100))),
				E('p', {}, [
					'%d/%d'.format(drop.current_minutes, drop.required_minutes), ' ',
					_('minutes watched'), ' • ',
					_('%s remaining').format(formatMinutes(drop.remaining_minutes))
				])
			];

			if (drop.is_claimed)
				children.push(E('p', {}, E('span', { 'class': 'label success' },
					_('Claimed') + ' ✓')));
			else if (drop.can_claim)
				children.push(E('p', {}, E('span', { 'class': 'label warning' },
					_('Ready to claim'))));

			return children;
		}

		function renderWebsockets(st) {
			var sockets = (st && st.websockets) || [];

			if (!sockets.length)
				return [ E('p', {}, _('No websocket connections.')) ];

			var topics = 0;

			sockets.forEach(function(ws) { topics += ws.topics || 0; });

			var list = sockets.map(function(ws) {
				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, _('Websocket #%d').format(ws.index + 1)),
					E('td', { 'class': 'td' },
						E('span', {
							'class': (ws.status === 'Connected') ? 'label success' : LABEL_BAD
						}, ws.status || _('Disconnected'))),
					E('td', { 'class': 'td' }, String(ws.topics || 0))
				]);
			});

			return [
				E('p', {}, _('%d topics in total, %d channels being tracked')
					.format(topics, Math.floor((topics - 2) / 2))),
				E('table', { 'class': 'table' }, list)
			];
		}

		function renderChannels(st) {
			var channels = (st && st.channels) || [];

			if (!channels.length)
				return [ E('p', {}, _('No channels.')) ];

			var rows = channels.map(function(ch) {
				return E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, [ ch.watching ? '▶ ' : '', ch.name ]),
					E('td', { 'class': 'td' }, ch.game || '-'),
					E('td', { 'class': 'td' }, ch.online ? _('Online') : (ch.pending ? _('Pending') : _('Offline'))),
					E('td', { 'class': 'td' }, ch.viewers != null ? String(ch.viewers) : '-'),
					E('td', { 'class': 'td' }, ch.drops_enabled ? '✔' : '✘'),
					E('td', { 'class': 'td' }, ch.acl_based ? '✔' : '')
				]);
			});

			var table = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Channel')),
					E('th', { 'class': 'th' }, _('Game')),
					E('th', { 'class': 'th' }, _('Status')),
					E('th', { 'class': 'th' }, _('Viewers')),
					E('th', { 'class': 'th' }, _('Drops')),
					E('th', { 'class': 'th' }, _('ACL'))
				])
			].concat(rows));

			return [ E('div', { 'style': 'max-height: 20em; overflow: auto;' }, [ table ]) ];
		}

		function serviceAction(action) {
			return fs.exec('/etc/init.d/twitchdropsminer', [ action ]).then(function() {
				return refreshServiceStatus();
			});
		}

		function refresh() {
			return Promise.all([ refreshServiceStatus(), readStatus(), refreshLog() ])
				.then(function(res) {
					var st = res[1];

					replace(infoEl, renderInfo(st));
					replace(campaignEl, renderCampaign(st));
					replace(dropEl, renderDrop(st));
					replace(wsEl, renderWebsockets(st));
					replace(channelsEl, renderChannels(st));
				});
		}

		poll.add(refresh, 5);
		refresh();

		var view = E([], [
			E('h2', {}, _('Twitch Drops Miner')),
			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, [ _('Service status:'), ' ', statusEl ]),
				E('div', { 'class': 'cbi-button-row' }, [
					E('button', {
						'class': 'cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(self, function() { return serviceAction('start'); })
					}, _('Start')),
					E('button', {
						'class': 'cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(self, function() { return serviceAction('stop'); })
					}, _('Stop')),
					E('button', {
						'class': 'cbi-button cbi-button-reload',
						'click': ui.createHandlerFn(self, function() { return serviceAction('restart'); })
					}, _('Restart'))
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Status')),
				infoEl
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Campaign progress')),
				campaignEl
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Drop progress')),
				dropEl
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Websockets')),
				wsEl
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Channels')),
				channelsEl
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Log')),
				logEl
			])
		]);

		return view;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
