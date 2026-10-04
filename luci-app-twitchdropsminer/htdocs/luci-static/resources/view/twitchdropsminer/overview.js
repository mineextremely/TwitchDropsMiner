'use strict';
'require view';
'require fs';
'require poll';
'require ui';

return view.extend({
	load: function() {
		return Promise.resolve();
	},

	render: function() {
		var self = this;
		var statusEl = E('span', { 'class': 'label' }, _('Checking...'));
		var logEl = E('pre', {
			'style': 'max-height: 25em; overflow: auto; white-space: pre-wrap; margin: 0;'
		}, _('Loading...'));

		function refreshStatus() {
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
			return fs.read('/tmp/twitchdropsminer.log').then(function(data) {
				var lines = (data || '').trim().split('\n');

				logEl.textContent = lines.slice(-200).join('\n') || _('(empty)');
				logEl.scrollTop = logEl.scrollHeight;
			}).catch(function() {
				logEl.textContent = _('No log available yet.');
			});
		}

		function serviceAction(action) {
			return fs.exec('/etc/init.d/twitchdropsminer', [ action ]).then(function() {
				return refreshStatus();
			});
		}

		poll.add(function() {
			return refreshStatus().then(refreshLog);
		}, 5);

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
			E('div', { 'class': 'alert-message note' }, [
				_('The miner signs in with the cookies.jar file in its data directory. ' +
				  'Copy it there from a machine where you completed the Twitch login.')
			]),
			E('h3', {}, _('Log')),
			E('div', { 'class': 'cbi-section' }, [ logEl ])
		]);

		refreshStatus();
		refreshLog();

		return view;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
