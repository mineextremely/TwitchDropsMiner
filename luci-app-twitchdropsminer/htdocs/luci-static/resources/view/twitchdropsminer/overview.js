'use strict';
'require view';
'require fs';
'require poll';
'require ui';

var STATUS_FILE = '/tmp/twitchdropsminer.status.json';
var LOG_FILE = '/tmp/twitchdropsminer.log';

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

return view.extend({
	load: function() {
		return Promise.resolve();
	},

	render: function() {
		var self = this;
		var statusEl = E('span', { 'class': 'label' }, _('Checking...'));
		var infoEl = E('div', {}, '-');
		var progressEl = E('div', {}, '-');
		var channelsEl = E('div', {}, '-');
		var logEl = E('pre', {
			'style': 'max-height: 25em; overflow: auto; white-space: pre-wrap; margin: 0;'
		}, _('Loading...'));

		function refreshServiceStatus() {
			return fs.exec('/etc/init.d/twitchdropsminer', [ 'status' ]).then(function(res) {
				var running = (res.code === 0);

				statusEl.textContent = running ? _('Running') : _('Stopped');
				statusEl.className = 'label ' + (running ? 'success' : 'danger');
			}).catch(function() {
				statusEl.textContent = _('Stopped');
				statusEl.className = 'label danger';
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
						? _('Logged in (user %d)').format(auth.user_id)
						: _('Not logged in')
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

		function renderProgress(st) {
			var p = st && st.progress;

			if (!p)
				return [ E('p', {}, _('Not mining at the moment.')) ];

			var drop = p.drop, campaign = p.campaign, pct = Math.round((drop.progress || 0) * 100);

			return [
				E('p', {}, [ E('strong', {}, campaign.game || '?'), ' — ', campaign.name ]),
				E('p', {}, [ _('Drop:'), ' ', drop.name || '-',
					(drop.rewards && drop.rewards.length ? ' (' + drop.rewards.join(', ') + ')' : '') ]),
				E('div', { 'class': 'cbi-progressbar', 'title': '%d%%'.format(pct) },
					E('div', { 'style': 'width:%d%%'.format(pct) })),
				E('p', {}, [
					'%d/%d'.format(drop.current_minutes, drop.required_minutes), ' ',
					_('minutes watched'), ' • ',
					_('%d min remaining').format(drop.remaining_minutes)
				]),
				E('p', {}, [
					_('Campaign:'), ' ',
					_('%d/%d drops claimed').format(campaign.claimed_drops, campaign.total_drops),
					' • ', '%d%%'.format(Math.round((campaign.progress || 0) * 100))
				])
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
					replace(progressEl, renderProgress(st));
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
				E('h3', {}, _('Current drop')),
				progressEl
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
